---
description: Implement executable tests for approved GENERATED scenarios in the target repo
---
Materialize approved GENERATED QA scenarios into executable tests in the target repo.

Target: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-qa-impl skill (`.opencode/skills/aialm-oss-qa-impl/SKILL.md`):

1. Resolve the target (functional children independently, or single id) and
   extract GENERATED QA + Implementation Contract hooks from its description
   (planTests/extractGeneratedQa/extractContract).
2. Gate: non-empty GENERATED QA required; if UI automation is required, a
   non-empty contract with approved hooks is required — otherwise BLOCK the
   target/scenario (run dev-analyst then dev-update-approved first). Never
   invent hooks.
3. Inspect the target repo clone (framework, config, fixtures, helpers, scripts
   per Profile) and reuse existing infra.
4. Write one executable test per scenario, binding contract hooks exactly, title
   `QA: <scenario name>`, path per Profile conventions (default `tests/qa/*`).
   No invented behavior; never weaken assertions to pass.
5. Run via Profile validation commands; classify honestly
   (IMPLEMENTED / IMPLEMENTED_WITH_FAILURES / BLOCKED).

MUST NOT modify AC/QA/contract/proposals, work item state, create work items or
touch GitHub PR state; never cross-read same-wave dev-impl diffs as requirements.
