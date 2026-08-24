---
description: Run the end-to-end consistency and traceability verification suite
---
Run the full V1 verification suite (happy path + failure/edge matrix).

Execute the aialm-oss-e2e-consistency skill (`.opencode/skills/aialm-oss-e2e-consistency/SKILL.md`):

1. Run `npm test` (deterministic unit/integration suite) and ensure every stage
   passes: adapters/onboard/discover/po/qa/dev/verify/pr/feedback + the interop
   sequence over the full path (dock + feedback loop).
2. Confirm no regressions to the failure/edge matrix (approval gates, duplicate
   imports, exclusive isolation, blocked-per-child, no locator leakage, core-only
   READY_FOR_PR, no-GitHub-writes except oss-pr, no same-wave cross-read).
3. On failure, report the exact failing artifact/assertion; never loosen an
   assertion to pass.

Only run tests — this skill makes no ALM or GitHub mutations.
