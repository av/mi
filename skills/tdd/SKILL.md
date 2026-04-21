---
name: tdd
description: Red/green/refactor loop for adding new behavior. Load when extending code that already has a test harness; one behavior at a time.
---

First, confirm a test harness exists (pytest, jest/vitest, `cargo test`, `go test`, rspec, etc.) and that the existing suite runs green. If there is no harness, stop and tell the user — do not scaffold one without being asked.

For each new behavior, run the loop below exactly once. Do not queue up multiple failing tests.

1. Red — write one failing test
   - Pick the smallest next behavior. Name the test after the behavior, not the implementation.
   - Place it beside sibling tests; match their style and imports.
   - Assert on observable output, not internals.

2. Red — confirm it fails for the right reason
   - Run only the new test (e.g. `pytest path::test_name`, `vitest run -t 'name'`, `cargo test name`).
   - The failure must be an assertion mismatch. If it is `ImportError`, `SyntaxError`, `ModuleNotFoundError`, or a typo — fix the test itself, then re-run. Do not proceed until the failure is a real assertion.

3. Green — minimum code to pass
   - Hardcode if that is genuinely the simplest thing; generality comes from the next failing test, not speculation.
   - Touch only files required to satisfy this test.
   - If making it pass turns into spelunking (unexpected errors, stack traces in unrelated code), stop and invoke the `debug` skill. Do not keep flailing.

4. Green — run the relevant subset
   - Run the whole file or module under test, not just the one case. Confirm green.
   - If anything else went red, you broke something — fix or revert before moving on.

5. Refactor
   - Rename, dedupe, extract — structural changes only, no new behavior.
   - Re-run the same subset. Still green, or revert the refactor.

Then stop and return to the caller, or start the loop again for the next behavior. Hand off to the `verify` skill before declaring the larger task done.
