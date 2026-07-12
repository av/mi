# Sub-routine: Bugbash

Systematic runtime exploration of the running software to find bugs, usability
issues, and edge cases with full reproduction evidence.

## When to Use

Phase 4 (Hardening), step 1. All slices are VERIFIED. The golden path works.
Now stress the edges by exercising the software as a real user would.

## Setup

Before dispatch:
1. Verify the software builds and runs.
2. Create output directory: `mkdir -p /tmp/bugbash-<slug>/logs /tmp/bugbash-<slug>/evidence`

## Dispatch

One subagent gets the running software and the full surface area:

```
You are bugbashing <project-name>. Systematically explore the software, find
real bugs, and produce a report with full reproduction evidence for every finding.

## Target
- Directory: ~/code/<slug>/
- Build: <build command>
- Run: <run command>
- Type: <CLI | server | library | TUI | etc>

## What Already Works
Read the manifest at <manifest-path>. Every VERIFIED slice describes a
capability and the commands that prove it. Use these as starting points.

<DISCIPLINE PRIMER>

## Output
Write findings to /tmp/bugbash-<slug>/report.md

## Workflow
1. Build and start the software.
2. Orient: map the surface area (help menus, endpoints, exported functions).
   Save to /tmp/bugbash-<slug>/surface-area.txt.
3. Explore systematically:
   - Happy paths: test primary use cases end-to-end.
   - Invalid inputs: wrong types, huge strings, malformed data, empty input.
   - Missing context: missing config, unset env vars, unauthenticated calls.
   - Boundary conditions: file not found, port in use, permission denied.
   - Combinations: pipe output of one command into another, chain operations.
4. Document each issue AS YOU FIND IT:
   - Description: what is the bug
   - Severity: Critical (crash/data loss), High (broken core), Medium (edge case), Low (UX/cosmetic)
   - Repro steps: exact commands a human can copy-paste to reproduce
   - Expected vs actual behavior
   - Evidence: stdout/stderr, exit codes, stack traces
5. Verify each issue is reproducible with at least one retry before documenting.
6. Stop when you run out of things to test. Finding zero issues is a valid
   result for well-built software — report what you find, not a quota.
7. Stop background processes. Finalize the report with summary counts.

## Rules
- Run every command. Report what actually happened.
- Capture environment state (pwd, env vars) when relevant to repro.
- Do not fix anything. Do not suggest fixes. Evidence only.
- All temporary files in /tmp. Never in the project directory.
```

## Expected Output

A report at `/tmp/bugbash-<slug>/report.md` with:
- Summary counts by severity
- Individual issues with full reproduction evidence
- Surface area map

## Interpretation

- **Critical/High**: must fix before shipping. Dispatch a builder for each,
  then verify the fix AND run the full regression suite.
- **Medium**: fix if time allows. Record in progress notes.
- **Low**: record only. Do not fix unless trivial.

## Failure Handling

Zero issues found is a valid result for a well-built product. Do not
re-dispatch with "try harder." Proceed to the next hardening step.

If the subagent cannot build or start the software, that is a regression.
Stop hardening. Go back to the slice loop and fix it.
