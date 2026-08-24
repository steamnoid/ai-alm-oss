---
description: Implement feature code for approved AC + Implementation Contract in the target repo
---
Materialize approved Product AC + Implementation Contract into feature code in the target repo.

Target: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-dev-impl skill (`.opencode/skills/aialm-oss-dev-impl/SKILL.md`):

1. Resolve the target (functional children independently, or single id) and
   read its inputs via implTargetInputs (Product AC, GENERATED QA, contract hooks).
2. Gate per target (planImpl): require approved Product AC, non-empty GENERATED
   QA and a non-empty Implementation Contract; when UI is in scope require
   approved hooks — otherwise BLOCK the target. Never invent hooks or behavior.
3. Inspect the target repo clone (app structure, patterns, auth, routes,
   components, libs, unit tests, typecheck/lint commands per Profile) and reuse
   existing infrastructure.
4. Implement AC behaviors and wire every approved hook exactly (same hook
   strings). No silent scope expansion, never weaken product behavior.
5. Run Profile typecheck/lint/unit; classify honestly
   (IMPLEMENTED / IMPLEMENTED_WITH_FAILURES / BLOCKED).

MUST NOT modify AC / GENERATED QA / contract intent, work item state/priority,
create work items, open PRs, or read same-wave qa-impl specs as requirements.
