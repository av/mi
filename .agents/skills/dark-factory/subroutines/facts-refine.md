# Sub-routine: Facts Refinement

Drive `@draft` facts to `@spec` with validation commands so a builder can implement them.

## When to Use

Before building any slice that has `@draft` facts. Every fact must be `@spec`
with a validation command before a builder touches it.

## Dispatch

One subagent per slice's fact group:

```
You are refining facts for a software project.

## Fact-Driven Development

This project uses the `facts` CLI for specification.

- Facts are atomic, testable statements in a `.facts` file.
- Tags: @draft (being refined), @spec (ready to implement), @implemented (done).
- Every @spec fact must have a validation command.
- Run `facts list` to see all facts. Run `facts check` to validate.
- Never remove or edit fact tags without the `facts` CLI.

## Your Task

Refine these @draft facts to @spec:

<list of fact IDs and labels>

For each fact:
1. Read it. Is it atomic and testable as written? If not, split or reword
   using `facts edit`.
2. Write a validation command: `facts edit <id> --command "<command>"`
   The command must be runnable and produce a clear pass/fail.
3. Tag it @spec: `facts edit <id> --add-tag spec --remove-tag draft`
4. Run `facts check` to verify the validation command executes cleanly.

## Rules
- Do not implement the facts. Only refine them to be implementable.
- Do not add new facts unless splitting a vague one into multiple atomic ones.
- Every refined fact must have a working validation command.
- Commit before returning.
- All temporary files go in /tmp. Never in the project directory.
```

## Expected Output

Confirmation that all assigned facts are `@spec` with validation commands.
Any facts that could not be refined are reported with the specific blocker.

## Verification

After the subagent returns:
1. `facts list --tags draft` scoped to this slice's facts — must return empty.
2. `facts list --tags spec` — the refined facts must appear with commands.
3. `facts check` — validation commands must execute (may fail if the feature
   isn't built yet, but must not error on syntax).

## Failure Handling

If a fact is too vague or contradictory to refine (depends on an unresolved
design decision), escalate to the user with the specific fact and blocker.
Do not proceed to build a slice with unresolved facts.
