---
name: tdd
description: Add new behavior test-first (write failing test → make it pass → refactor). Use when asked to "add a test for", "implement X with tests", or extending a codebase that already has a test suite.
---

First, confirm a test harness exists (pytest, jest/vitest, `cargo test`, `go test`, rspec, etc.) and that the existing suite runs green. If there is no harness, stop and tell the user — do not scaffold one without being asked.

**Do not use TDD for:** exploratory spikes, one-off scripts, or behavior that is purely UI layout. Also do not use it when the test harness would require more effort to bootstrap than the feature itself — ask the user instead.

For each new behavior, run the loop below exactly once. Do not queue up multiple failing tests.

1. **Red — write one failing test**
   - Pick the smallest next behavior. "Smallest" means: one function, one branch, one edge case. Not "the whole feature."
   - Example: if adding CSV export, first test is `test_export_returns_bytes`, not `test_export_all_columns_with_header_and_quoting`.
   - Name the test after the behavior, not the implementation: `test_negative_price_is_rejected`, not `test_validate_price_calls_check_sign`.
   - Place it beside sibling tests; match their style and imports.
   - Assert on observable output (return value, file written, exception raised, stdout), not on internal state (private fields, method call counts).

2. **Red — confirm it fails for the right reason**
   - Run only the new test (e.g. `pytest path::test_name`, `vitest run -t 'name'`, `cargo test name`).
   - The failure must be an assertion mismatch or `NotImplementedError`. If it is `ImportError`, `SyntaxError`, `ModuleNotFoundError`, or a typo — fix the test itself, then re-run. Do not proceed until the failure is a real assertion.

3. **Green — minimum code to pass**
   - Hardcode if that is genuinely the simplest thing; generality comes from the next failing test, not speculation.
   - Touch only files required to satisfy this test.
   - If making it pass turns into spelunking (unexpected errors, stack traces in unrelated code), stop and call `skill("debug")` and follow its body. Do not keep flailing and do not proceed without loading it.

4. **Green — run the relevant subset**
   - Run the whole file or module under test, not just the one case. Confirm green.
   - If anything else went red, you broke something — fix or revert before moving on.

5. **Refactor**
   - Rename, dedupe, extract — structural changes only, no new behavior.
   - Re-run the same subset. Still green, or revert the refactor.
   - For significant structural changes (rename across many callsites, extract to a new module, split a large class), call `skill("refactor")` and follow its body — it handles callsite sweeps and the green gate properly.

**Common anti-patterns to avoid:**
- Writing multiple failing tests before any green (defeats the feedback loop).
- Asserting on internal state or mocks when the public contract is testable.
- Skipping step 2 and discovering the test never actually ran.
- Refactoring production code and tests simultaneously in step 5.

Then stop and return to the caller, or start the loop again for the next behavior. Before declaring the larger task done, call `skill("verify")` and follow its body. Do not declare done without loading it.
