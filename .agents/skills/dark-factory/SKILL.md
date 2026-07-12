---
name: dark-factory
description: >
  Autonomous software production with continuous runtime verification. Takes a raw
  idea and produces a fully working product by building depth-first in verified slices.
  Each slice adds one capability to working software, verified by actually running it
  before the next begins. Absorbs the best of forge, discipline, timeboxed-iterating,
  bugbash, and agent-integration-testing into one end-to-end workflow. Use when the user
  says "dark factory", "build this", "forge this", "make this into a product", or any
  variant of "turn this idea into working software".
---

# Dark Factory — Lights-Out Software Production

Turn a raw idea into software that actually works — software a human can run
and use right now, not software that "should work."

You are a thin dispatcher and state machine. All productive work happens inside
subagents. Your context is reserved for orchestration: decomposition, dispatch,
verification, gating. You write no code, no config, no "quick fixes."

---

## Core Constraint

The software works after every change — not at the end, not after integration.

A product is "forged" only when:
- Every slice has been independently verified by **running** the software
- Zero regressions in previously verified capabilities
- `facts check` passes cleanly
- At least one independent verification agent has signed off after running real commands
- The user has approved the project name and constraints

---

## Core Principles

Non-negotiable. Every decision the orchestrator and its subagents make must
be consistent with all of them.

1. **Depth-first, not breadth-first.** Build one working thing, extend it.
   Never build N half-working things. The software grows like a tree — trunk
   first, then branches — not like a house of cards. Agents naturally produce
   locally coherent, globally incoherent software. The only fix is build order:
   build A, verify it runs, build B on top of A, verify both work together.
   Never build two things that haven't been proven to compose.

2. **Runtime verification, not code review.** The software must be launched
   and exercised. "Compiles" is necessary but not sufficient. "Looks right in
   the source" is not verification. The verifier runs the software and checks
   observable behavior.

3. **Builder and verifier are always separate agents.** The agent that built
   it never verifies it. This is structural, not advisory. Confirmation bias
   is the default; separation is the only reliable defense.

4. **Regression is a blocker.** If adding feature N breaks feature N-1, you
   fix the regression before anything else. Forward progress requires backward
   compatibility.

5. **Spot-check every delivery.** Subagent reports can contain hallucinated
   evidence — commands that were never run, outputs that were never observed.
   After every subagent return: `git status`, `git log -1`, and run one
   verification command yourself to confirm reality matches the report.

6. **Orchestrator does no work.** You dispatch, verify, and gate. If you
   catch yourself writing code, stop. That belongs in a subagent.

7. **Facts are the spec.** Atomic, verifiable statements organized by slice.
   The `.facts` file is the single source of truth for what the product should
   do. User constraints are facts.

8. **Evidence over assertion.** Every verification produces exact commands,
   exact outputs, exact pass/fail. "It works" without evidence is the same as
   "it doesn't work."

9. **One change at a time.** Each slice adds exactly one capability. Each
   builder subagent has exactly one narrow charter. Compound changes make
   failures undiagnosable.

10. **Working beats complete.** A product with 5 working features beats one
    with 15 broken features. If time or budget runs out, deliver what works.

---

## Compact Workflow

```
Intake → Bootstrap & Slicing → [Skeleton ─ HARD GATE] → Slice Loop → Hardening → Ship
 (user)     (autonomous)                                      │
                                                 ┌────────────┘
                                                 ▼
                                           ┌───────────┐
                                           │  Refine   │
                                           │  facts    │
                                           │  for      │
                                           │  slice N  │
                                           └─────┬─────┘
                                                 ▼
                                           ┌───────────┐
                                           │  Build    │◄──────────┐
                                           │  slice N  │           │
                                           └─────┬─────┘           │
                                                 ▼                 │
                                           ┌───────────┐           │
                                           │  Verify   │──FAIL────►│ (max 3 cycles)
                                           │  slice N  │           │
                                           │  + regr.  │           │
                                           └─────┬─────┘           │
                                                 │                 │
                                               PASS            3 FAILS
                                                 │                 │
                                                 ▼                 ▼
                                           Next slice         Escalate
                                           or Hardening       to user
```

---

## The Slice Model

A **slice** is an ordered unit of capability that:
- Adds exactly one user-facing behavior to the software
- Is independently verifiable by running the software
- Builds on all previous slices (depends on them working)
- Has specific facts associated with it
- Has specific verification commands defined up front

### Slice 0: The Walking Skeleton

Always the first slice. The minimum thing that:
- Builds/compiles/installs without errors
- Launches/starts without crashing
- Accepts the most basic user input or request
- Produces the most basic output or response
- Shuts down cleanly

| Project type  | What the skeleton looks like |
|---------------|----------------------------|
| CLI           | Binary compiles, `--help` works, simplest command runs end-to-end |
| Server / API  | Starts, binds port, health endpoint responds 200, shuts down on signal |
| Library       | Installs, can be imported, simplest public function returns correct value |
| Game          | Window opens, entity renders, entity moves, camera follows, can quit |
| TUI           | Launches, renders initial screen, responds to one keypress, quits cleanly |
| Worker/daemon | Starts, picks one item from queue/input, processes it, logs result, exits |

The skeleton is a **hard gate**. Nothing proceeds until it is verified by an
independent verifier. If the skeleton doesn't work after 3 build-verify cycles,
escalate to the user.

### Slice Ordering Rules

1. Dependencies before dependents.
2. Core interaction loop before secondary features.
3. Input handling before output formatting.
4. Happy path before error handling.
5. Infrastructure (config, persistence, logging) before features that need it — but only just-in-time, not speculatively. Building frameworks before features is a trap.
6. Performance, polish, and optimization are late slices. The golden path must work before you tune it.
7. One capability per slice. If two features don't depend on each other, they are separate slices.

### Slice Sizing

A well-shaped slice:
- Can be explained in one sentence ("add config file loading", "handle authentication")
- Has 2-5 associated facts
- Can be built by a single subagent in one dispatch
- Has clear, concrete verification commands defined before building starts
- Does not require changes across more than 3-4 files

If a slice needs a paragraph to describe, split it. If it only needs one fact
and one trivial verification command, combine it with an adjacent slice.

There is no hard maximum on slice count. A complex project may have 20+ slices.
The constraint is slice shape, not count.

### Reordering Slices Mid-Build

If you discover mid-build that slice N+2 should have come before slice N+1:
reorder the PENDING slices in the manifest. Never redo VERIFIED slices. Adjust
the plan, not the past.

---

## The Manifest

The manifest is the ground truth of what works. It lives at
`~/.harness/dark-factory/<slug>/manifest.md` and is the primary coordination
artifact between all subagents.

**Pass the manifest by path, not by content.** Subagents read it themselves.
This keeps the orchestrator's context lean. The primers (Facts, Discipline)
are short enough to inline — the manifest is not.

### What It Tracks

- Project metadata: name, type, directory, build/run/shutdown commands
- Every slice: name, status, associated facts, verification commands, results
- What the software can do RIGHT NOW, proven by evidence

### Format

```markdown
# Manifest: <project-name>

## Project
- Type: <CLI | server | library | game | TUI | worker | other>
- Directory: ~/code/<slug>/
- Build: <exact build command>
- Run: <exact run command>
- Shutdown: <shutdown command or signal>

## Slices

### Slice 0: <name> [VERIFIED]
Facts: <fact IDs or short descriptions>
Verification: see verifications/slice-0.md
Verified at: <commit hash>

### Slice 1: <name> [VERIFIED]
Facts: ...
Verification: see verifications/slice-1.md
Verified at: <commit hash>

### Slice 2: <name> [BUILDING]
Facts: ...
Verification (expected):
- `<command>` → <expected>

### Slice 3: <name> [PENDING]
Facts: ...
Verification (expected):
- `<command>` → <expected>
```

Evidence files (`verifications/slice-N.md`) store the full CHECK/COMMAND/EXPECTED/ACTUAL/RESULT
records. This keeps the manifest compact as slices accumulate.

### Manifest Rules

- Updated by the orchestrator only. Never by subagents.
- Written to disk after every status change.
- Statuses: `PENDING` → `BUILDING` → `VERIFIED`. On failure: back to `BUILDING`.
- Only one slice may be `BUILDING` at a time.
- Verification commands can be updated if interfaces change — note the change in the manifest.

---

## The State File

The state file is the orchestrator's durable memory. It lives at
`~/.harness/dark-factory/<slug>/state.md` and persists across context
compressions, session interruptions, and duration-bounded runs.

Written by the orchestrator after every significant event. Read by the
orchestrator at the start of every dispatch cycle.

### Format

```markdown
# State: <project-name>

## Timing
- Started: <unix timestamp> (<human-readable>)
- Deadline: <unix timestamp or "none"> (<human-readable>)
- Last update: <unix timestamp> (<human-readable>)

## Current Phase
<phase number and name>

## Progress Log
### <timestamp> — <event>
<one-line summary>

### <timestamp> — <event>
<one-line summary>
```

### What Gets Logged

- Phase transitions
- Slice status changes (PENDING → BUILDING → VERIFIED)
- Builder dispatches and returns
- Verifier dispatches and verdicts
- Escalations
- Spot-check results
- Hardening sub-routine dispatches and outcomes
- Duration-bounded mode: deadline and time checks

### Rules

- Append-only. Never edit or remove previous entries.
- The timing section is updated in place (last update always current).
- In duration-bounded mode, always read the timing section and check
  `date +%s` against the deadline before every dispatch.

---

## Verification Protocol

### What the Verifier Does

For the slice under verification:

1. **Clean build.** Run the build command from scratch. Must succeed.
2. **Launch.** Start the software. Must not crash.
3. **Exercise new capability.** Run every verification command for the current
   slice. Record exact command, expected output, actual output, PASS/FAIL.
4. **Regression check.** Run every verification command for ALL previously
   verified slices. Any FAIL = regression. Skipping regression checks is how
   previously working features silently break — never skip them.
5. **Clean shutdown.** Stop the software. Must not hang.

### What Counts as Verification

| Counts | Does NOT count |
|--------|---------------|
| Running a command and checking exit code + output | Reading the source code and saying "looks right" |
| Sending an HTTP request and checking the response | The builder's delivery report |
| Importing a library and calling its API | "It should work based on the implementation" |
| Launching an app and observing it start/respond | `facts check` alone (necessary, not sufficient) |
| Running a test suite that exercises the feature | Compilation succeeding |

### Evidence Format

Every check must produce:

```
CHECK: <what is being verified>
COMMAND: <exact command run>
EXPECTED: <what should happen>
ACTUAL: <what actually happened — exact output>
RESULT: PASS | FAIL
```

### Orchestrator Spot-Check

After the verifier returns, you do NOT just trust the report. Run at minimum:
1. The build command
2. The run command (verify it starts)
3. One verification command from the current slice
4. One verification command from a previous slice

This catches hallucinated verification — the most dangerous failure mode,
because it looks like success.

---

## Primers

Include these blocks in every subagent prompt that touches the project.

### Facts Primer

```
## Fact-Driven Development

This project uses the `facts` CLI for specification.

- Facts are atomic, testable statements in a `.facts` file.
- Tags: @draft (being refined), @spec (ready to implement), @implemented (done).
- Every @spec fact should have a validation command.
- Run `facts list` to see all facts. Run `facts check` to validate.
- Never remove or edit fact tags without the `facts` CLI.
- User constraints are expressed as facts — discover them via `facts list`.
```

### Discipline Primer

```
## Operating Rules

- Verify every URL, flag, package name, and file path exists before using it.
  If you haven't confirmed it this session, treat it as unknown.
- Run the code and check its output before reporting it works.
- Commit all changes before returning. Confirm with `git status`.
- Write temporary files to /tmp only. Keep the project directory clean.
- Stay within your charter. Implement exactly what was assigned.
- When something fails, read the full error output and diagnose the root cause
  before your next attempt.
```

---

## Phases

### Phase 0: Intake (User Gate)

This is the **only** phase that requires user interaction. Gather everything
the orchestrator needs to work autonomously through the rest of the process.
After this phase, the factory runs lights-out.

1. **Capture the idea.** Understand what the user wants to build.
2. **Name the project.** Pick the obvious slug. Ask the user only if ambiguous.
3. **Capture constraints.** Ask the user for:
   - Technologies to use or avoid
   - Non-goals and scope boundaries
   - Hard requirements
   - Duration (if time-bounded)
4. **Confirm.** Restate the name, idea, and constraints. Get user approval.

Do not proceed until the user has approved the project name and constraints.
Do not ask for anything else during later phases — you have everything you need.

**Exit criteria:** User has approved name, idea is clear, constraints are captured.

---

### Phase 1: Bootstrap & Slicing (Autonomous)

Everything from here on is fully autonomous. No user interaction.

1. **Verify tools.** Confirm `facts` CLI is available (`which facts`). If not,
   exit with install instructions.
2. **Bootstrap locally.**
   - Create `~/code/<slug>/`, `git init`
   - Run `facts init` (this also scaffolds `.agents/skills/` and updates project docs)
   - Seed user constraints as `@spec` facts (clear, testable constraints) or
     `@draft` facts (constraints that need refinement before they are implementable)
   - Seed remaining requirements as `@draft` facts
   - Initial commit
   - Verify: `ls`, `git status`, `facts list`
3. **Set working directory.** `cd ~/code/<slug>/` — stay here for all subsequent
   phases. Subagents inherit this working directory.
4. **Initialize harness directory.**
   - Create `~/.harness/dark-factory/<slug>/`
   - Write `mission.md` (raw idea + success criteria from intake)
   - Write `state.md` (timing, current phase)
   - If duration-bounded: record start time (`date +%s`) and computed deadline
     in `state.md`
5. **Decompose into slices.**
   - Identify the walking skeleton (slice 0)
   - Identify the core interaction loop (slice 1, sometimes part of slice 0)
   - Order remaining capabilities by dependency using the ordering rules
   - For each slice: name, description, associated facts, verification commands
6. **Write the manifest.** All slices PENDING except slice 0 → BUILDING.
7. **Refine slice 0 facts.** All `@draft` facts for slice 0 → `@spec` with
   validation commands. See `subroutines/facts-refine.md` for the dispatch
   protocol.

**Exit criteria:** Manifest exists with all slices defined. Slice 0 facts are
`@spec`. Local project is committed. Harness directory is initialized.

---

### Phase 2: Skeleton (Hard Gate)

1. **Dispatch builder.**
   - Mission excerpt, Facts Primer, Discipline Primer, manifest path
   - Charter: "Build slice 0. Make these facts true. Commit. Run the
     verification commands yourself before returning."

2. **Verify builder committed.** `git status`, `git log -1`.

3. **Dispatch verifier.**
   - Manifest path, Discipline Primer
   - Charter: "Verify slice 0. Build the project from scratch. Launch it.
     Run every verification command. Report evidence for each."

4. **Check evidence.** Every check needs COMMAND + EXPECTED + ACTUAL + RESULT.

5. **Spot-check.** Run the build, launch, and one verification command yourself.

6. **Gate.**
   - All pass → manifest: slice 0 = VERIFIED, update state file, proceed to Phase 3
   - Any fail → dispatch builder with failure evidence, re-verify (max 3 cycles)
   - 3 failures → escalate to user with all evidence

7. **Update state file.** Log the skeleton outcome.

**This is a hard gate. Do not proceed to Phase 3 with a broken skeleton under
any circumstances.** The temptation to skip is proportional to how "obvious"
the skeleton seems. This is the trap.

---

### Phase 3: Slice Loop (The Factory Floor)

For each remaining slice, in order:

**Duration gate (if time-bounded).** Before every slice dispatch: read
`state.md` timing, run `date +%s`, compare against deadline. If the deadline
has passed, stop the loop and deliver what is VERIFIED.

**3a. Refine.** If this slice has `@draft` facts, dispatch a subagent to drive
them to `@spec` with validation commands. See `subroutines/facts-refine.md`
for the full dispatch protocol. Verify with `facts list`.

**3b. Build.** Update manifest: slice → BUILDING. Dispatch builder with:
- Mission excerpt, Facts Primer, Discipline Primer, manifest path
- The specific facts for this slice
- Charter: "Build slice N. Make these facts true. Do NOT break existing
  capabilities. Commit before returning."

**3c. Verify committed.** `git status`, `git log -1`.

**3d. Verify.** Dispatch verifier with:
- Manifest path, Discipline Primer
- Charter: "Verify slice N. Build, launch, run all slice N verification
  commands. Then run ALL verification commands from slices 0 through N-1
  as regression check. Report evidence for every check."

**3e. Check evidence.** Read the verifier report. Every check needs evidence.
Pay special attention to regression results.

**3f. Spot-check.** Build, launch, one new command, one old command.

**3g. Gate.**
- All pass, no regression → manifest: slice N = VERIFIED, update state file,
  next slice
- New capability fails → dispatch builder to fix with exact failure evidence,
  re-verify (max 3 cycles)
- Regression → fix regression first, then re-verify everything
- 3 failures on same slice → escalate to user

**Invariants:**
- Regression is always fixed before new features
- Only one slice is BUILDING at a time — never parallelize construction
- The builder for slice N is always a fresh subagent (no accumulated context
  from building slice N-1 — it reads the manifest for context)
- In duration-bounded mode: read `state.md` timing section and check `date +%s`
  against the deadline before every slice dispatch

---

### Phase 4: Hardening

All slices are VERIFIED. The software works end-to-end. Now stress the edges.

Each hardening step has a full dispatch protocol documented in a separate file.
Read the referenced file before dispatching.

1. **Bugbash.** Systematic runtime exploration of the running software.
   See `subroutines/bugbash.md` for the dispatch protocol.

2. **Static review.** Parallel source code review for logic bugs, race
   conditions, and resource leaks.
   See `subroutines/static-review.md` for the dispatch protocol.

3. **Integration tests.** Formal test specs written and executed by subagents.
   Skip for trivial projects where slice verification commands cover the behavior.
   See `subroutines/integration-testing.md` for the dispatch protocol.

4. **Fix.** For each Critical/High issue found in steps 1-3: dispatch a builder
   to fix it, then verify the fix AND run the full regression suite. Same
   build-verify cycle as Phase 3 but scoped to the fix.

5. **Final verification.** Run every verification command from every slice one
   last time. Must be completely clean.

The golden path already works at this point. Hardening finds corners — not
fundamental integration failures. If basic functionality breaks here, something
went wrong in Phase 3. Investigate, don't paper over it.

---

### Phase 5: Ship

Only after hardening passes:

1. `facts check` → must pass
2. `facts list --tags spec` → must return zero results (all `@implemented`)
3. `gh repo create <slug> --private --source=. --remote=origin --push`
4. `gh repo view <slug>` → verify it exists

Private by default. The user can change visibility later if they want.

First time code leaves the local machine.

---

## Subagent Prompts

### Builder

```
You are building one slice of a software project.

## Mission
<excerpt from mission.md>

<FACTS PRIMER>

<DISCIPLINE PRIMER>

## Your Slice
Name: <slice name>
Description: <what this slice adds>

## Your Facts
<list each fact with its validation command>

## What Already Works
Read the manifest at <path>. It describes every verified capability and the
commands that prove it. Your code builds on this working foundation. Do not
break it.

## Rules
- Implement ONLY the facts listed above. Agents drift beyond scope by default.
  Your narrow charter prevents compound changes that make failures undiagnosable.
- Do NOT modify code outside your slice's scope unless necessary for integration.
- Run the validation commands for your facts before returning.
- Run at least one verification command from a previous slice to sanity-check
  that you haven't introduced a regression.
- Commit with a descriptive message before returning.
- If you cannot make a fact true, explain exactly what is blocking you.
```

### Verifier

```
You are verifying a software project. You did NOT build this code.
Your job is to run it and report what actually happens.

Read the manifest at <path>. It contains the build, run, and shutdown
commands and every verification command per slice.

<DISCIPLINE PRIMER>

## Protocol
1. Read the Project section of the manifest for build/run/shutdown commands.
2. Build from scratch using the build command.
3. Launch using the run command.
4. Run EVERY verification command for the slice marked BUILDING.
5. Run EVERY verification command for ALL slices marked VERIFIED (regression).
6. Shut down using the shutdown command.

## Evidence Format
For every single check:
  CHECK: <description>
  COMMAND: <exact command>
  EXPECTED: <from manifest>
  ACTUAL: <exact output you observed>
  RESULT: PASS | FAIL

Write evidence to the file path provided by the orchestrator (verifications/).

## Rules
- Run every command. Do not skip any.
- Report what actually happened, not what should have happened.
- If build or launch fails, that is your entire report. Stop there.
- When a command fails, include the full error output. Read code at locations
  referenced in stack traces to provide context — but running the software is
  the verification, not reading the source.
- Report evidence only. Do not fix anything or suggest fixes.
```

---

## Common Traps

These are the failure modes that look like progress:

- **Skipping the skeleton** because "it's obvious" — it never is
- **Doing product work yourself** — writing code, editing config, "quick fixes"
- **Declaring VERIFIED without evidence** — a subagent report is not evidence;
  exact command + exact output is
- **Proceeding past a regression** — forward progress requires backward compatibility
- **3 failures without escalation** — the user needs to know, not a 4th retry

---

## Escalation Protocol

When a slice fails 3 build-verify cycles:

1. Collect all evidence: builder reports, verifier reports, exact outputs.
2. Write summary to `~/.harness/dark-factory/<slug>/escalations/<slice>.md`.
3. Log the escalation in the state file.
4. Present to user:
   - What the slice is trying to achieve
   - What was attempted (all 3 approaches, briefly)
   - What specifically fails (exact evidence)
   - Your assessment of root cause
   - Options: redesign the slice, split it, change approach, drop it
5. Wait for user direction.

Do NOT silently skip the slice, reduce scope without approval, or try a 4th
approach.

---

## Duration-Bounded Mode

If the user provides a duration ("build this in 4 hours", "overnight run"):

- Record start time and computed deadline in `state.md` during Phase 1.
- The duration gate in Phase 3 enforces the deadline before every dispatch.
- When the deadline passes: stop the loop, write a progress summary to the
  state file, deliver what is VERIFIED.
- A verified slice 4 beats an unverified slice 8.
- "Overnight" means 8 hours.

---

## Resumption

If `~/.harness/dark-factory/<slug>/` exists:
1. Read `state.md` for current phase and progress log.
2. Read `manifest.md` for slice statuses.
3. Find the first non-VERIFIED slice. Resume there.
4. If a slice is BUILDING, dispatch a verifier first — the builder may have
   finished before interruption.
5. Continue from the appropriate phase.

The manifest and state file are the sources of truth.

---

## Harness Directory

`~/.harness/dark-factory/<slug>/`

```
mission.md        — raw idea + success criteria
manifest.md       — slice plan, statuses, verification evidence
state.md          — timing, current phase, chronological progress log
escalations/      — escalation reports (if any)
verifications/    — raw verification reports from verifier agents
```

---

## Success Condition

The product is forged when:
- Every slice is VERIFIED in the manifest
- Hardening (Phase 4) completed, all Critical/High issues fixed
- `facts check` passes
- `facts list --tags spec` returns zero results
- Full verification suite passed one final time
- GitHub repo exists with pushed code (Phase 5)

Tell the user the product is complete. Show them how to build and run it.
Report the final verification results.
