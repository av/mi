# Sub-routine: Integration Testing

Write and execute formal integration test specs against the running software.
Tests that capabilities compose correctly across slice boundaries.

## When to Use

Phase 4 (Hardening), step 3. After bugbash and static review.

Use when the project has external interfaces (APIs, CLIs with complex I/O,
services with multiple endpoints). Skip for trivial projects where the slice
verification commands already cover the behavior.

## Setup

1. The software must build and run.
2. Create test directory: `mkdir -p ~/.harness/dark-factory/<slug>/tests/`

## Dispatch: Spec Writing

One subagent writes the test specification:

```
You are writing integration test specifications for <project-name>.

## What the Software Does
Read the manifest at <manifest-path>. Every VERIFIED slice describes a
capability with verification commands.

<DISCIPLINE PRIMER>

## Your Task
Write a test spec at ~/.harness/dark-factory/<slug>/tests/integration.md.

Structure:

### Prerequisites
Exact commands to set up the test environment (build, start services,
seed data, set env vars).

### Test N: <name>
**Steps:**
1. <exact command or request>
2. <exact command or request>

**Expectations:**
1. <specific verifiable outcome>
2. <specific verifiable outcome>

## Rules
- Every expectation must be verifiable by running a command and checking
  output. "UI looks correct" is not verifiable. "Exit code is 0" is.
- Focus on integration: test that capabilities compose correctly across
  slice boundaries. Do not re-test individual slice behavior.
- Cover: happy paths, error handling, cross-feature edge cases.
- Target 10-20 test cases for the critical integration points.
- All temporary files in /tmp. Never in the project directory.
```

## Dispatch: Execution

After the spec is written and committed, dispatch one subagent per test
group (3-5 related tests per agent), all in parallel:

```
You are executing integration tests for <project-name>.

Test spec: ~/.harness/dark-factory/<slug>/tests/integration.md
Read it. Follow the Prerequisites section first.

Execute tests <N through M>. For each test:
1. Run the steps exactly as written.
2. Check each expectation.
3. Report:
   TEST: <name>
   STEPS: <what you ran>
   EXPECTED: <from spec>
   ACTUAL: <exact output>
   RESULT: PASS | FAIL

## Rules
- Execute every assigned test. Do not skip.
- Report actual output, not what you think should happen.
- If prerequisites fail, stop and report the prerequisite failure.
- Do not modify the test spec. Do not fix failures. Evidence only.
```

## Expected Output

- A test spec at `~/.harness/dark-factory/<slug>/tests/integration.md`
- Pass/fail evidence for every test case

## Interpretation

- All pass → hardening step complete.
- Isolated failures → dispatch a builder to fix each failing integration
  point, then re-run those tests only.
- Over 50% failure → something is fundamentally wrong. This is not a
  hardening-level problem. Go back to the slice loop.

## Failure Handling

If the spec contains unverifiable tests ("check output looks correct"),
reject the spec and re-dispatch with instructions to rewrite those tests
with concrete verification commands (exit codes, HTTP status codes, file
contents, stdout patterns).
