---
description: Produce auditable validation evidence and a PR-readiness verdict from Profile commands + GENERATED QA
---
Run validation commands and produce PR-readiness evidence for a delivery wave.

Target: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-verify skill (`.opencode/skills/aialm-oss-verify/SKILL.md`):

1. Resolve the work item(s) + wave outputs, and read Profile.ciCommands.
2. Execute each command in order and capture evidence via makeEvidence
   (command + exit code + log ref + pass/fail/error). Never claim success
   without captured output.
3. Run the GENERATED QA suite and map outcomes to scenarios (scenarioIdFor /
   scenarioResult), keeping each scenario's kind.
4. Classify each child via classifyChild (PASS / PARTIAL / FAILED / BLOCKED).
5. Compute the PR verdict via prReadiness — READY_FOR_PR only when ALL CORE
   scenarios are green.
6. Post one append-only verification evidence summary on the parent; point to
   logs for any FAILED scenario, explicit reason for BLOCKED.

MUST NOT modify code/tests, change ALM item states, open/close PRs, or comment
on GitHub.
