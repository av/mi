"""Harbor agent adapter for mi — a minimal autonomous agent CLI.

Includes diagnostics to debug failure modes:
- Pre-flight LLM connectivity check with timing
- Timestamped output (each line prefixed with elapsed seconds)
- Separate stderr capture
- Network diagnostics on failure
"""

import base64
import json
import shlex
import tomllib
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from mi_harbor.package import local_package_archive


TERMINAL_BENCH_CHECK = (
    "Inspect the actual task state in the working directory (run pwd first). "
    "FIRST: if /tests/ exists, run `cd / && python3 -m pytest tests/ --tb=short 2>&1 | tail -80` — "
    "test results are GROUND TRUTH. If any test fails, NACK immediately. If all pass, ACK. "
    "If no /tests/: run any visible test suite (pytest, npm test, make test, etc.). "
    "Check exact output file paths mentioned in the goal — verify they exist and are non-empty. "
    "For parseable artifacts (code, JSON, config), verify they parse/compile/import without error. "
    "For numeric thresholds, measure the actual value and compare to the required value — "
    "do not accept qualitative assessments. Meeting the exact stated threshold is a PASS — "
    "note values within 5% of the bar as a risk, but never NACK for margin. "
    "Verify input files are unchanged unless the goal explicitly requires modifying them. "
    "Do NOT kill, restart, or stop any running services — the external verifier needs them alive. "
    "End with ACK only when ALL checks pass with measured values; otherwise end with NACK."
)


# System prompt optimized for eval tasks. Shorter than the interactive DEFAULT_PROMPT,
# Docker-aware, test-first oriented, no persona/formatting restrictions.
EVAL_SYSTEM_PROMPT = (
    "You are an autonomous coding agent in a Linux terminal inside a Docker container. "
    "Your tools are bash and file editing.\n\n"
    "Act, don't speculate. Read the task description and any README in the working directory. "
    "Check if /tests/ exists — those tests define success criteria. "
    "Explore the working directory, then solve. One step at a time, verify each.\n\n"
    "If something fails, read the error, form a diagnosis, change approach. "
    "Don't repeat failed strategies.\n\n"
    "Docker constraints: containers may use BusyBox (limited coreutils). "
    "No systemd. Use nohup for background services so they survive shell exit. "
    "Do not kill running services after verification.\n\n"
    "Minimize context: head -20 for file starts, tail -20 for ends, grep -n to locate, "
    "sed -n for ranges. Reserve cat for short files. Edit with sed -i or heredocs.\n\n"
    "Do not fake tool output."
)


# Wrapper script that adds timestamps and captures diagnostics
DIAGNOSTIC_WRAPPER = r'''#!/bin/bash
set -o pipefail

LOG_DIR="/logs/agent"
STDOUT_LOG="$LOG_DIR/mi-output.txt"
STDERR_LOG="$LOG_DIR/mi-stderr.txt"
TIMING_LOG="$LOG_DIR/timing.txt"
DIAG_LOG="$LOG_DIR/diagnostics.txt"
API_BASE="${OPENAI_BASE_URL:-https://api.openai.com}"
API_BASE="${API_BASE%/}"
API_BASE="${API_BASE%/v1}"
HEALTH_URL="$API_BASE/v1/models"
TIMING_FINALIZED=0

mkdir -p "$LOG_DIR"

log_diag() {
    echo "[$(date -Iseconds)] $1" >> "$DIAG_LOG"
}

# Trap signals to run post-mortem even if killed externally
cleanup() {
    local exit_code=$?
    log_diag "=== SIGNAL/EXIT CLEANUP (code=$exit_code) ==="
    log_diag "Output lines: $(wc -l < "$STDOUT_LOG" 2>/dev/null || echo 0)"
    log_diag "Last output timestamp: $(tail -1 "$STDOUT_LOG" 2>/dev/null | grep -oE '^\[[[:space:]]*[0-9.]+s\]' || echo 'none')"

    # Post-mortem LLM check
    POST_CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" \
        "$HEALTH_URL" \
        -H "Authorization: Bearer $OPENAI_API_KEY" 2>/dev/null || echo "failed")
    log_diag "Post-mortem LLM status: HTTP $POST_CODE"

    # Network check
    PING_RESULT=$(ping -c 1 -W 2 172.17.0.1 2>&1 | grep -E 'time=|unreachable' || echo 'failed')
    log_diag "Post-mortem ping gateway: $PING_RESULT"

    if [[ "$TIMING_FINALIZED" != "1" ]]; then
        echo "end=$(date +%s.%N)" >> "$TIMING_LOG"
        echo "exit_code=$exit_code" >> "$TIMING_LOG"
    fi
    log_diag "=== CLEANUP COMPLETE ==="
}
trap cleanup EXIT TERM INT

# Record start time
START_TIME=$(date +%s.%N)
log_diag "=== MI AGENT START ==="
log_diag "LLM endpoint: ${OPENAI_BASE_URL:-https://api.openai.com}"
log_diag "LLM health URL: $HEALTH_URL"
log_diag "Model: ${MODEL:-gpt-5.4}"

# Pre-flight: test LLM connectivity
log_diag "Pre-flight LLM connectivity check..."
PREFLIGHT_START=$(date +%s.%N)
HEALTH_RESPONSE=$(curl -s -m 10 -w "\n%{http_code}\n%{time_total}" \
    "$HEALTH_URL" \
    -H "Authorization: Bearer $OPENAI_API_KEY" 2>&1)
PREFLIGHT_END=$(date +%s.%N)
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -2 | head -1)
CURL_TIME=$(echo "$HEALTH_RESPONSE" | tail -1)
log_diag "Pre-flight completed: HTTP $HTTP_CODE in ${CURL_TIME}s"

if [[ "$HTTP_CODE" != "200" ]]; then
    log_diag "WARNING: LLM endpoint returned HTTP $HTTP_CODE"
    log_diag "Response: $(echo "$HEALTH_RESPONSE" | head -5)"
fi

# Function to add timestamps to each line
timestamp_output() {
    while IFS= read -r line; do
        ELAPSED=$(echo "$(date +%s.%N) - $START_TIME" | bc)
        printf "[%8.2fs] %s\n" "$ELAPSED" "$line"
    done
}

log_diag "Starting mi agent..."
echo "start=$(date +%s.%N)" > "$TIMING_LOG"

# Compute deadline for budget-aware goal loop (60s buffer for verifier)
if [[ -n "$MI_TASK_TIMEOUT" ]]; then
    DEADLINE=$(echo "$START_TIME + $MI_TASK_TIMEOUT - 60" | bc | cut -d. -f1)
    export MI_DEADLINE="$DEADLINE"
    log_diag "Budget: ${MI_TASK_TIMEOUT}s task timeout, deadline=$DEADLINE (60s verifier buffer)"
fi

if [[ -f /opt/mi/index.mjs ]]; then
    MI_RUNNER=(node /opt/mi/index.mjs)
else
    MI_RUNNER=(npx @avcodes/mi)
fi

detect_workdir() {
    local fallback=""
    for candidate in /app /workdir /home /workspace /work /root /src; do
        [[ -d "$candidate" ]] || continue
        # Prefer directories with .git
        if [[ -d "$candidate/.git" ]]; then
            echo "$candidate"; return
        fi
        # Check for nested git repos (use -exec for BusyBox compat)
        GIT_DIRS=$(find "$candidate" -mindepth 1 -maxdepth 2 -type d -name .git -exec dirname {} \; 2>/dev/null | head -2)
        GIT_COUNT=$(printf '%s\n' "$GIT_DIRS" | { grep -c . 2>/dev/null || true; })
        GIT_COUNT=${GIT_COUNT:-0}
        if [[ "$GIT_COUNT" -eq 1 ]]; then
            echo "$GIT_DIRS"; return
        fi
        # Remember first non-empty candidate as fallback (skip empty dirs like /home)
        if [[ -z "$fallback" ]] && [[ -n "$(ls -A "$candidate" 2>/dev/null | head -1)" ]]; then
            fallback="$candidate"
        fi
    done
    echo "${fallback:-/}"
}
WORKDIR=$(detect_workdir)
log_diag "Workdir: $WORKDIR"
cd "$WORKDIR" || cd / || exit 1

# Inject task README into AGENTS.md for auto-ingestion by mi subagents.
# Only if AGENTS.md doesn't already exist and a README is found.
if [[ ! -f AGENTS.md ]]; then
    README=""
    for rf in README.md README.txt README readme.md; do
        if [[ -f "$rf" ]]; then README="$rf"; break; fi
    done
    if [[ -n "$README" ]]; then
        {
            echo "# Task Context"
            echo ""
            head -100 "$README"
        } > AGENTS.md
        log_diag "Injected $README into AGENTS.md for mi context"
    fi
fi

# Run mi goal loop with timestamped output, separate stderr
exec 3> >(timestamp_output | tee "$STDOUT_LOG")
STDOUT_PS_PID=$!
exec 4> >(timestamp_output | tee "$STDERR_LOG" >&2)
STDERR_PS_PID=$!
"${MI_RUNNER[@]}" -g "$1" -c "$MI_GOAL_CHECK" >&3 2>&4
EXIT_CODE=$?
# Close FDs and wait for the log writers to flush — otherwise the script can
# exit before tee finishes, leaving mi-output.txt/mi-stderr.txt empty/truncated.
exec 3>&- 4>&-
wait "$STDOUT_PS_PID" "$STDERR_PS_PID" 2>/dev/null || true

echo "end=$(date +%s.%N)" >> "$TIMING_LOG"
echo "exit_code=$EXIT_CODE" >> "$TIMING_LOG"
TIMING_FINALIZED=1

END_TIME=$(date +%s.%N)
TOTAL_TIME=$(echo "$END_TIME - $START_TIME" | bc)
log_diag "MI agent finished with exit code $EXIT_CODE after ${TOTAL_TIME}s"
log_diag "=== MI AGENT END ==="

# Exit triggers the cleanup trap which runs post-mortem diagnostics
exit $EXIT_CODE
'''


class MiAgent(BaseInstalledAgent):
    """Harbor adapter for mi (https://github.com/av/mi).

    Includes diagnostic instrumentation to debug failure modes:
    - Pre-flight LLM connectivity check
    - Timestamped output lines
    - Separate stdout/stderr capture
    - Post-mortem network diagnostics
    """

    SUPPORTS_ATIF: bool = False  # mi doesn't produce structured trajectory logs

    def _compute_task_timeout(self) -> float | None:
        """Compute per-task timeout by reading task.toml from Harbor's cache.

        Harbor computes _agent_timeout_sec from task.toml but only passes it
        to Oracle agents. This method replicates that computation by:
        1. Reading trial config.json (written by Harbor before agent.run())
        2. Finding task.toml in Harbor's cache using the task name
        3. Extracting [agent].timeout_sec and applying the timeout multiplier

        Returns the effective timeout in seconds, or None if unavailable.
        """
        try:
            config_path = self.logs_dir.parent / "config.json"
            if not config_path.exists():
                return None

            trial_config = json.loads(config_path.read_text())

            # Check for explicit override first
            override = (trial_config.get("agent") or {}).get("override_timeout_sec")
            multiplier = trial_config.get("agent_timeout_multiplier")
            if multiplier is None:
                multiplier = trial_config.get("timeout_multiplier", 1.0)

            if override:
                max_sec = (trial_config.get("agent") or {}).get("max_timeout_sec")
                base = min(override, max_sec) if max_sec else override
                return base * multiplier

            # Find task.toml in Harbor's cache
            task_toml_path = self._find_task_toml(trial_config)
            if not task_toml_path:
                return None

            task_config = tomllib.loads(task_toml_path.read_text())
            base_timeout = (task_config.get("agent") or {}).get("timeout_sec")
            if base_timeout is None:
                return None

            max_sec = (trial_config.get("agent") or {}).get("max_timeout_sec")
            if max_sec:
                base_timeout = min(base_timeout, max_sec)

            return base_timeout * multiplier
        except Exception as exc:
            self.logger.debug(f"Could not compute task timeout: {exc}")
            return None

    @staticmethod
    def _find_task_toml(trial_config: dict) -> Path | None:
        """Find task.toml in Harbor's cache from trial config metadata."""
        cache_dir = Path.home() / ".cache" / "harbor" / "tasks"
        task_info = trial_config.get("task", {})

        # Extract task name from config
        task_path = task_info.get("path")  # relative path for git-based tasks
        task_name = task_info.get("name")  # org/name for package-based tasks

        if task_path:
            # Git-based tasks: ~/.cache/harbor/tasks/<hash>/<task_path>/task.toml
            for match in cache_dir.glob(f"*/{task_path}/task.toml"):
                # Skip the packages subdirectory
                if "packages" not in match.parts:
                    return match

        if task_name:
            # Package-based: ~/.cache/harbor/tasks/packages/<org>/<name>/*/task.toml
            pkg_path = task_name  # already in org/name format
            for match in cache_dir.glob(f"packages/{pkg_path}/*/task.toml"):
                return match

        if task_path:
            # Fallback: try package cache with just the task name
            for match in cache_dir.glob(f"packages/*/{task_path}/*/task.toml"):
                return match

        return None

    @staticmethod
    def name() -> str:
        return "mi"

    def get_version_command(self) -> str | None:
        return "if test -f /opt/mi/index.mjs; then node /opt/mi/index.mjs -h; else npx @avcodes/mi -h; fi 2>&1 | head -1 || echo unknown"

    def parse_version(self, stdout: str) -> str:
        return stdout.strip() or "unknown"

    async def install(self, environment: BaseEnvironment) -> None:
        # Prefer the local checkout. This avoids npm network install per trial and
        # ensures evals exercise exactly the repo under test.
        package = local_package_archive()

        # Install runtime dependencies only when the task image does not already have them.
        # Some Terminal-Bench images ship an old Node binary; mi needs Node 18+.
        await self.exec_as_root(
            environment,
            command=(
                "set -e;"
                "NEED_NPM=" + ("0" if package else "1") + ";"
                "node_ok(){ command -v node >/dev/null 2>&1"
                " && node -e \"process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)\" >/dev/null 2>&1; };"
                "deps_ok(){ node_ok && command -v bc >/dev/null 2>&1"
                " && command -v curl >/dev/null 2>&1 && command -v ping >/dev/null 2>&1"
                " && { test \"$NEED_NPM\" != 1 || command -v npm >/dev/null 2>&1; }; };"
                "if deps_ok; then exit 0; fi;"
                "node_ok && NODE_PKG='' || NODE_PKG='nodejs npm';"
                "if command -v apk >/dev/null 2>&1; then"
                "  apk add --no-cache $NODE_PKG bc curl iputils ca-certificates xz;"
                " elif command -v apt-get >/dev/null 2>&1; then"
                "  apt-get update && apt-get install -y --no-install-recommends $NODE_PKG bc curl iputils-ping ca-certificates xz-utils && rm -rf /var/lib/apt/lists/*;"
                " elif command -v yum >/dev/null 2>&1; then"
                "  yum install -y $NODE_PKG bc curl iputils ca-certificates xz;"
                " fi;"
                "if ! node_ok && ! command -v apk >/dev/null 2>&1; then"
                "  arch=$(uname -m); case \"$arch\" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo \"unsupported node arch: $arch\"; exit 1;; esac;"
                "  ver=v22.11.0; dir=/usr/local/node-$ver-linux-$arch;"
                "  curl -fsSL \"https://nodejs.org/dist/$ver/node-$ver-linux-$arch.tar.xz\" -o /tmp/node.tar.xz;"
                "  rm -rf \"$dir\" && mkdir -p \"$dir\";"
                "  tar -xJf /tmp/node.tar.xz -C \"$dir\" --strip-components=1;"
                "  ln -sf \"$dir/bin/node\" /usr/local/bin/node;"
                "  ln -sf \"$dir/bin/npm\" /usr/local/bin/npm;"
                "  ln -sf \"$dir/bin/npx\" /usr/local/bin/npx;"
                "  hash -r 2>/dev/null || true;"
                " fi;"
                "if ! deps_ok; then echo 'mi runtime dependency check failed';"
                "  command -v node >/dev/null 2>&1 && node --version || true;"
                "  exit 1; fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        if package:
            archive, digest = package
            probe = await self.exec_as_agent(
                environment,
                command=(
                    f"if test \"$(cat /opt/mi/.mi_package_hash 2>/dev/null)\" = '{digest}'"
                    " && node /opt/mi/index.mjs -h >/dev/null 2>&1;"
                    " then echo MI_PACKAGE_READY; else echo MI_PACKAGE_MISSING; fi"
                ),
            )
            if "MI_PACKAGE_READY" in (probe.stdout or ""):
                return
            b64 = base64.b64encode(archive).decode()
            await self.exec_as_agent(
                environment,
                command=(
                    "rm -rf /opt/mi && mkdir -p /opt/mi"
                    f" && echo '{b64}' | base64 -d | tar -xzf - -C /opt/mi"
                    f" && echo '{digest}' > /opt/mi/.mi_package_hash"
                    " && node /opt/mi/index.mjs -h"
                ),
            )
        else:
            version_spec = f"@{self._version}" if self._version else ""
            await self.exec_as_agent(
                environment,
                command=f"npm install -g @avcodes/mi{version_spec} && npx @avcodes/mi -h",
            )

    def populate_context_post_run(self, context: AgentContext) -> None:
        # Read diagnostic logs for context
        stdout_path = self.logs_dir / "mi-output.txt"
        timing_path = self.logs_dir / "timing.txt"
        diag_path = self.logs_dir / "diagnostics.txt"

        if stdout_path.exists():
            try:
                content = stdout_path.read_text(encoding="utf-8")
                context.n_output_tokens = len(content.split())
            except OSError:
                pass

        # Log timing info if available
        if timing_path.exists():
            try:
                timing = timing_path.read_text(encoding="utf-8")
                # Parse timing file for metadata
                context.metadata = context.metadata or {}
                context.metadata["timing_raw"] = timing.strip()
            except OSError:
                pass

        # Include diagnostics summary in metadata
        if diag_path.exists():
            try:
                diag = diag_path.read_text(encoding="utf-8")
                context.metadata = context.metadata or {}
                context.metadata["diagnostics"] = diag[-2000:]  # Last 2KB
            except OSError:
                pass

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped_instruction = shlex.quote(instruction)

        # Build environment for mi
        env: dict[str, str] = {
            "PAGER": "cat",
            "GIT_PAGER": "cat",
            "GIT_EDITOR": "true",
            "VISUAL": "true",
            "EDITOR": "true",
            "TERM": "dumb",
            "MI_GOAL_CHECK": TERMINAL_BENCH_CHECK,
        }

        # mi uses OpenAI-compatible API
        api_key = (
            self._get_env("OPENAI_API_KEY")
            or self._get_env("MI_API_KEY")
            or ""
        )
        if api_key:
            env["OPENAI_API_KEY"] = api_key

        base_url = self._get_env("OPENAI_BASE_URL") or self._get_env("MI_BASE_URL")
        if base_url:
            # Rewrite localhost URLs for container access using Docker bridge gateway
            base_url = base_url.replace("localhost", "172.17.0.1")
            base_url = base_url.replace("127.0.0.1", "172.17.0.1")
            env["OPENAI_BASE_URL"] = base_url

        # Model selection: strip provider prefix if present
        if self.model_name:
            model = self.model_name
            if "/" in model:
                model = model.split("/", 1)[-1]
            env["MODEL"] = model

        # Sampling/routing determinism pins (set by run scripts via determinism-env.sh)
        for var in ("MI_API_PARAMS", "MI_JUDGE_PARAMS", "MI_JUDGE_MODEL"):
            value = self._get_env(var)
            if value:
                env[var] = value

        # System prompt: use eval-optimized prompt by default, allow override
        system_prompt = self._get_env("MI_SYSTEM_PROMPT")
        env["SYSTEM_PROMPT"] = system_prompt or EVAL_SYSTEM_PROMPT

        # Pass task timeout for budget-aware goal loop.
        # Without MI_TASK_TIMEOUT, the goal loop runs without budget phases
        # (no EXPLORE→COMMIT→URGENT→SALVAGE transitions, no time partitioning,
        # no forced salvage before timeout).
        # Priority: explicit env var > computed from task.toml + multiplier.
        task_timeout = self._get_env("MI_TASK_TIMEOUT")
        if not task_timeout:
            # Compute per-task timeout from Harbor's cached task.toml.
            # This gives us the EXACT value Harbor uses for asyncio.wait_for(),
            # correctly calibrated per-task (300s-3600s in TBLite).
            computed = self._compute_task_timeout()
            if computed is not None:
                task_timeout = str(int(computed))
                self.logger.debug(
                    f"Computed MI_TASK_TIMEOUT={task_timeout}s from task.toml"
                )
        if task_timeout:
            env["MI_TASK_TIMEOUT"] = task_timeout

        if not env.get("OPENAI_API_KEY"):
            raise RuntimeError(
                "OPENAI_API_KEY or MI_API_KEY environment variable required for mi"
            )

        # Write diagnostic wrapper script to container
        wrapper_path = "/tmp/mi-wrapper.sh"
        await self.exec_as_agent(
            environment,
            command=f"cat > {wrapper_path} << 'WRAPPER_EOF'\n{DIAGNOSTIC_WRAPPER}\nWRAPPER_EOF\nchmod +x {wrapper_path}",
            env=env,
            cwd="/",
        )

        # Run mi via diagnostic wrapper (wrapper detects workdir internally)
        await self.exec_as_agent(
            environment,
            command=f"bash {wrapper_path} {escaped_instruction}",
            env=env,
            cwd="/",
        )
