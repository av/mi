"""Harbor installed agent for mi (https://github.com/av/mi).

Runs the local checkout of mi in goal mode (`mi -g <task> -c <check>`) inside
the task container. Run it through the configs in bench/configs/ (see
docs/benchmarking.md); the import path is `bench.mi_agent:MiAgent`.

The eval prompt, goal check and workspace snapshot below are the ones every
historical score in docs/benchmark-history.md was measured with — change them
deliberately and A/B the change.
"""

import atexit
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Annotated, Any

from pydantic import Field

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.model_connection import ModelConnectionSpec
from harbor.agents.options import Env, InstalledAgentOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

REPO = Path(__file__).resolve().parent.parent
PACKAGE_PATHS = ("index.mjs", "package.json", "README.md", "tools", "skills")
NODE_VERSION = "v22.11.0"
NODE_CACHE = Path.home() / ".cache" / "mi-bench"
PROVIDER_RE = re.compile(r"\[provider\] ([^(\x1b\n]+?) \(")

TERMINAL_BENCH_CHECK = (
    "Inspect the actual task state in the working directory (run pwd first). "
    "A hidden external verifier runs after you finish — predict its checks from the goal text "
    "and any visible tests; visible /tests/ may not cover every requirement. "
    "FIRST: if /tests/ exists, run `cd / && python3 -m pytest tests/ --tb=short 2>&1 | tail -80` — "
    "test results are GROUND TRUTH for what they cover. If any test fails, NACK immediately. "
    "If no /tests/: run any visible test suite (pytest, npm test, make test, etc.). "
    "Then verify EVERY goal-stated output path, threshold, format, and preservation constraint — "
    "check exact paths exist and are non-empty; parseable artifacts must parse/compile/import. "
    "For numeric thresholds, measure the actual value and compare to the required value — "
    "do not accept qualitative assessments. Meeting the exact stated threshold is a PASS — "
    "note values within 5% of the bar as a risk, but never NACK for margin. "
    "Verify input files are unchanged unless the goal explicitly requires modifying them. "
    "Do NOT kill, restart, or stop any running services, VMs, or emulators — "
    "the external verifier needs them alive and unperturbed. "
    "End with ACK only when ALL checks pass with measured values; otherwise end with NACK."
)

EVAL_SYSTEM_PROMPT = (
    "You are an autonomous coding agent in a Linux terminal inside a Docker container. "
    "Your tools are bash and file editing.\n\n"
    "Act, don't speculate. Read the task description, AGENTS.md snapshot, and any README. "
    "A hidden verifier grades your work after you finish — the goal text defines success; "
    "visible /tests/ may be incomplete. Write required output files early as drafts, then refine. "
    "Explore briefly, then solve. One step at a time, verify each requirement with measured values.\n\n"
    "If something fails, read the error, form a diagnosis, change approach. "
    "Don't repeat failed strategies. Do not stop on partial progress or plausible-looking output.\n\n"
    "Docker constraints: containers may use BusyBox (limited coreutils). "
    "No systemd. Use nohup for background services so they survive shell exit. "
    "Never kill VMs, emulators, QEMU, or long-boot services — leave them running for the verifier.\n\n"
    "Minimize context: head -20 for file starts, tail -20 for ends, grep -n to locate, "
    "sed -n for ranges. Reserve cat for short files. Edit with sed -i or heredocs.\n\n"
    "Do not fake tool output."
)

# Node for mi: the task's own node if >= 18, else a private copy in
# /opt/mi-node that the wrapper puts first on PATH (mi spawns subagents as
# `node`), else apk's nodejs on musl images.
INSTALL = r"""
set -e
chmod -R a+rX /opt/mi
node_ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' >/dev/null 2>&1; }
NODE=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then NODE="$(command -v node)"; fi
if [ -z "$NODE" ] && [ -f /tmp/mi-node.tar.gz ]; then
  mkdir -p /opt/mi-node && tar -xzf /tmp/mi-node.tar.gz -C /opt/mi-node --strip-components=1
  node_ok /opt/mi-node/bin/node && NODE=/opt/mi-node/bin/node
fi
rm -f /tmp/mi-node.tar.gz
if [ -z "$NODE" ] && command -v apk >/dev/null 2>&1; then apk add --no-cache nodejs >/dev/null && NODE="$(command -v node)"; fi
[ -n "$NODE" ] || { echo "mi: no usable node >= 18" >&2; exit 1; }
echo "$NODE" > /opt/mi/NODE
"$NODE" /opt/mi/index.mjs -v
"""

# $1 = task instruction. Workdir detection and the AGENTS.md snapshot match the
# historical adapter; the budget env (MI_DEADLINE, MI_GOAL_MAX) drives the
# goal loop's EXPLORE/COMMIT/URGENT/SALVAGE phases.
WRAPPER = r"""
set -o pipefail
LOG=/logs/agent
mkdir -p "$LOG"
NODE="$(cat /opt/mi/NODE)"
[ "$NODE" = /opt/mi-node/bin/node ] && export PATH="/opt/mi-node/bin:$PATH"
START=$(date +%s)
if [ -n "$MI_TASK_TIMEOUT" ]; then
  export MI_DEADLINE=$(( START + MI_TASK_TIMEOUT - 60 ))
  GOAL_MAX=$(( MI_TASK_TIMEOUT / 150 )); (( GOAL_MAX < 4 )) && GOAL_MAX=4; (( GOAL_MAX > 12 )) && GOAL_MAX=12
  export MI_GOAL_MAX=$GOAL_MAX
fi

detect_workdir() {
  local fallback=""
  for c in /app /workdir /home /workspace /work /root /src; do
    [ -d "$c" ] || continue
    [ -d "$c/.git" ] && { echo "$c"; return; }
    local gits; gits=$(find "$c" -mindepth 1 -maxdepth 2 -type d -name .git -exec dirname {} \; 2>/dev/null | head -2)
    [ -n "$gits" ] && [ "$(printf '%s\n' "$gits" | wc -l)" -eq 1 ] && { echo "$gits"; return; }
    [ -z "$fallback" ] && [ -n "$(ls -A "$c" 2>/dev/null | head -1)" ] && fallback="$c"
  done
  echo "${fallback:-/}"
}
WORKDIR=$(detect_workdir)
cd "$WORKDIR" || cd /
{
  echo "# Task Context"; echo
  for rf in README.md README.txt README readme.md; do [ -f "$rf" ] && { head -100 "$rf"; break; }; done
  echo; echo "## Workspace Snapshot"; echo '```'
  pwd; ls -la . 2>/dev/null | head -30
  [ -d /tests ] && { echo "--- /tests/ ---"; ls -la /tests/ 2>/dev/null | head -20; }
  find . -maxdepth 2 -type f 2>/dev/null | head -40
  echo '```'
} > AGENTS.md
{ echo "workdir=$WORKDIR"; echo "task_timeout=${MI_TASK_TIMEOUT:-unset}"; echo "deadline=${MI_DEADLINE:-unset}"
  echo "goal_max=${MI_GOAL_MAX:-unset}"; echo "node=$NODE"; echo "start=$START"; } > "$LOG/run.txt"

stamp() { while IFS= read -r line; do printf '[%6ds] %s\n' "$SECONDS" "$line"; done; }
SECONDS=0
"$NODE" /opt/mi/index.mjs -g "$1" -c "$MI_GOAL_CHECK" \
  2> >(stamp > "$LOG/mi-stderr.txt") | stamp > "$LOG/mi-output.txt"
CODE=$?
sleep 1  # let the stderr stamper flush
echo "end=$(date +%s)" >> "$LOG/run.txt"; echo "exit_code=$CODE" >> "$LOG/run.txt"
exit $CODE
"""


class MiOptions(InstalledAgentOptions):
    """Agent kwargs (`--ak key=value` or `agents[].kwargs`). The determinism
    knobs are merged into MI_API_PARAMS, which mi sends with every request."""

    temperature: float | None = Field(default=0, description="Sampling temperature.")
    seed: int | None = Field(default=42, description="Sampling seed (honored only by some providers).")
    provider: str | None = Field(
        default=None,
        description="OpenRouter provider pin (e.g. alibaba), no fallbacks. Ignored for other providers.",
    )
    api_params: str | None = Field(
        default=None, description="Extra JSON merged into MI_API_PARAMS last (env MI_API_PARAMS)."
    )
    judge_model: Annotated[str | None, Env("MI_JUDGE_MODEL", fallback="MI_JUDGE_MODEL")] = Field(
        default=None, description="Separate model for the goal judge."
    )
    judge_params: str | None = Field(
        default=None, description="JSON for the judge's requests (default: same as MI_API_PARAMS)."
    )
    reasoning_effort: Annotated[str | None, Env("REASONING_EFFORT", fallback="REASONING_EFFORT")] = Field(
        default=None, description="Passed through to mi."
    )
    task_timeout: int | None = Field(
        default=None, description="Seconds for the goal budget (default: the trial's real agent timeout)."
    )
    system_prompt: str | None = Field(default=None, description="Replaces the eval system prompt.")


class MiAgent(BaseInstalledAgent):
    options_model = MiOptions
    MODEL_CONNECTION = ModelConnectionSpec()
    _stage: Path | None = None

    @staticmethod
    def name() -> str:
        return "mi"

    def get_version_command(self) -> str | None:
        return "cat /opt/mi/VERSION"

    @classmethod
    def _staged_checkout(cls) -> Path:
        """Copy of the checkout's runtime files, built once per Harbor process."""
        if cls._stage is None:
            stage = Path(tempfile.mkdtemp(prefix="mi-bench-"))
            atexit.register(shutil.rmtree, stage, True)
            for name in PACKAGE_PATHS:
                src = REPO / name
                (shutil.copytree if src.is_dir() else shutil.copy2)(src, stage / name)
            version = json.loads((REPO / "package.json").read_text())["version"]
            git = lambda *a: subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True).stdout.strip()
            sha, dirty = git("rev-parse", "--short", "HEAD"), git("status", "--porcelain", "--", *PACKAGE_PATHS)
            (stage / "VERSION").write_text(f"{version}+{sha or 'nogit'}{'-dirty' if dirty else ''}\n")
            (stage / "bench-run.sh").write_text(WRAPPER)
            cls._stage = stage
        return cls._stage

    @staticmethod
    def _node_tarball(arch: str) -> Path | None:
        arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(arch)
        if not arch:
            return None
        path = NODE_CACHE / f"node-{NODE_VERSION}-linux-{arch}.tar.gz"
        if not path.exists():
            NODE_CACHE.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=NODE_CACHE, suffix=".part")
            os.close(fd)
            urllib.request.urlretrieve(f"https://nodejs.org/dist/{NODE_VERSION}/{path.name}", tmp)
            os.replace(tmp, path)
        return path

    async def install(self, environment: BaseEnvironment) -> None:
        await environment.upload_dir(self._staged_checkout(), "/opt/mi")
        arch = (await environment.exec(command="uname -m", user="root")).stdout or ""
        if tarball := self._node_tarball(arch.strip()):
            await environment.upload_file(tarball, "/tmp/mi-node.tar.gz")
        await self.exec_as_root(environment, command=INSTALL)

    def _task_timeout(self) -> int | None:
        """The agent timeout Harbor enforces for this trial, recomputed from the
        trial config and task.toml the same way Harbor's Trial does (Harbor
        only hands it to its oracle agent)."""
        if self.options.task_timeout:
            return self.options.task_timeout
        try:
            from harbor.models.task.task import Task
            from harbor.models.trial.config import TrialConfig

            cfg = TrialConfig.model_validate_json((self.logs_dir.parent / "config.json").read_text())
            task = Task(cfg.task.get_local_path(), disable_verification=True)
            base = cfg.agent.override_timeout_sec or task.config.agent.timeout_sec
            if base is None:
                return None
            mult = cfg.agent_timeout_multiplier
            mult = cfg.timeout_multiplier if mult is None else mult
            return int(min(base, cfg.agent.max_timeout_sec or float("inf")) * mult)
        except Exception as exc:
            self.logger.warning(f"mi: task timeout unknown, goal loop runs without a budget: {exc}")
            return None

    def _api_params(self) -> dict[str, Any]:
        o = self.options
        params: dict[str, Any] = {k: v for k, v in (("temperature", o.temperature), ("seed", o.seed)) if v is not None}
        if o.provider and self.model_connection.provider == "openrouter":
            params["provider"] = {"order": [o.provider], "allow_fallbacks": False}
        extra = o.api_params or self._get_env("MI_API_PARAMS")
        return params | (json.loads(extra) if extra else {})

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        conn = self.model_connection
        if not conn.api_key:
            raise RuntimeError(f"mi: no API key for provider {conn.provider!r} (model {self.model_name!r})")
        base_url = (conn.base_url or "").replace("localhost", "172.17.0.1").replace("127.0.0.1", "172.17.0.1")
        params = json.dumps(self._api_params(), separators=(",", ":"))
        env = {
            "OPENAI_API_KEY": conn.api_key,
            "MODEL": self.model_name.split("/", 1)[-1] if conn.provider else self.model_name,
            "MI_API_PARAMS": params,
            "MI_JUDGE_PARAMS": self.options.judge_params or params,
            "SYSTEM_PROMPT": self.options.system_prompt or EVAL_SYSTEM_PROMPT,
            "MI_GOAL_CHECK": TERMINAL_BENCH_CHECK,
            "PAGER": "cat", "GIT_PAGER": "cat", "GIT_EDITOR": "true", "VISUAL": "true", "EDITOR": "true", "TERM": "dumb",
            **self.resolve_env_vars(),
        }
        if base_url:
            env["OPENAI_BASE_URL"] = base_url
        if timeout := self._task_timeout():
            env["MI_TASK_TIMEOUT"] = str(timeout)
        await self.exec_as_agent(
            environment, command=f"bash /opt/mi/bench-run.sh {shlex.quote(instruction)}", env=env, cwd="/"
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        run = self.logs_dir / "run.txt"
        meta = dict(line.split("=", 1) for line in run.read_text().splitlines() if "=" in line) if run.exists() else {}
        # mi prints "[provider] <name> (<model>)" once per upstream; subagent stderr lands in mi-output.txt.
        logs = [self.logs_dir / n for n in ("mi-output.txt", "mi-stderr.txt")]
        meta["providers"] = sorted({m for f in logs if f.exists() for m in PROVIDER_RE.findall(f.read_text(errors="replace"))})
        context.metadata = {**(context.metadata or {}), "mi": meta}
