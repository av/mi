# Sub-routine: Static Review

Parallel source code review for logic bugs, race conditions, and resource
leaks. Complements bugbash (runtime) by analyzing code structure.

## When to Use

Phase 4 (Hardening), step 2. After bugbash. The software runs and has been
exercised. Now find bugs that runtime testing might miss: race conditions,
resource leaks, logic errors in untested paths.

## Setup

Before dispatch:
1. Read the project source yourself. Identify natural section boundaries:
   per module, per layer, per file. Each section should be reviewable in
   isolation. The same code must not be reviewed by two agents.
2. Create output directory: `mkdir -p /tmp/static-review-<slug>/`

## Dispatch: Discovery

Send one subagent per section, all in parallel (all Agent calls in one message):

```
You are reviewing <project-name> for bugs. Your section is <section-name>
covering <file-path(s)>.

Read the code. Look for real bugs only.

For each bug found, report:
- **ID**: <SECTION>-NNN (e.g., AUTH-001)
- **Severity**: Critical / High / Medium / Low
- **Description**: what is wrong and why it matters
- **File:Line**: exact location
- **Evidence**: code snippet showing the bug
- **Impact**: what breaks, under what conditions

Only report bugs that could actually trigger in practice. Contrived
preconditions are not bugs. Finding nothing is a valid result — do not
invent findings to fill the format.

Return a structured list, or state that no bugs were found.

## Rules
- Read the code. Do not run the software.
- Do not fix anything. Report only.
- Do not report style issues, naming preferences, or missing comments.
- Focus: logic errors, race conditions, resource leaks, unhandled error paths,
  security issues, data corruption risks.
```

## After All Discovery Agents Return

1. Compile findings into `/tmp/static-review-<slug>/report.md`.
2. Deduplicate issues found by multiple sections.

## Dispatch: Triage

For each finding above Low severity, dispatch a separate triage subagent
(all in parallel):

```
You are triaging a potential bug in <project-name>.

Finding <ID> (claimed <severity>): <one-paragraph description>
File: <file>, lines <range>.

Read the code at that location. Answer:
1. Is this a real bug? Can a user actually hit it?
2. What preconditions are required? How likely are they?
3. Is the claimed severity correct?
4. Are there mitigating factors the original reviewer missed?

Verdict: CONFIRMED / DISPUTED / DOWNGRADE
Reasoning: (under 150 words)
```

## Interpretation

- **CONFIRMED Critical/High** → must fix. Dispatch builder with the exact
  finding as context, then verify the fix and run full regression.
- **CONFIRMED Medium** → fix if time allows.
- **DOWNGRADED** → record at the new severity. Fix only if still Medium+.
- **DISPUTED** → record in report with rejection reason. Do not fix.

## Failure Handling

If all findings are disputed, that is valid. Proceed to the next hardening step.

If a triage agent cannot determine whether a bug is real, read the code at
that location yourself and make the call.
