---
description: Propose implementation/testability contract details for functional children with AC + GENERATED QA
---
Propose Implementation Contract details for qualifying functional children.

Target work item: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-dev-analyst skill (`.opencode/skills/aialm-oss-dev-analyst/SKILL.md`):

1. Resolve targets: analyze each qualifying child independently (sorted by
   identifier), skipping legacy `QA`-prefixed titles; single target when none.
2. Per target, gate on Product AC AND non-empty GENERATED QA — post ONE
   [AI-generated] Blocked — <key> comment and continue the others when missing.
3. LLM produces DevProposal[] per target (SEAM / LOCATOR / API / UI-STATE /
   DATA / OPEN), each traceable to sourceProductAC + GENERATED QA, with
   concrete deterministic test ids / states / API outcomes, consumers
   ["qa-impl","dev-impl"], and profileRefs. Max 2 CREATIVE per run.
4. analyzeDev validates Profile-fit: seams contradicting Profile restrictions are
   rejected (not posted). Posts one Implementation Contract Proposal comment per
   passing proposal (idempotent by proposalId) + a summary on the parent.

Only retrieve and comment — never modify description/state/labels, create work
items, write tests/app code, or merge the contract.
