---
description: Create functional child work items from an approved decomposition package
---
Create real functional children for a parent from its approved decomposition package.

Target parent: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-po-decompose skill (`.opencode/skills/aialm-oss-po-decompose/SKILL.md`):

1. Retrieve the parent + comments + reactions + existing children.
2. Find the latest human-approved aialm-oss-po-prep-decompose package
   (hasHumanApprovalFor) via decompose().
3. If none, or the package is invalid (deps/acyclic/AC) → post ONE
   NOT_ATTEMPTED summary row and stop (decompose handles this).
4. Otherwise create children sequentially in dependency order, parent =
   parentKey, description inheriting externalSource + ## Goal / ## Scope /
   ## Acceptance Criteria / ## Dependencies / ## Traceability (with
   childKey + packageProposal markers for idempotency), resolving childKey deps
   to created keys as you go.
5. Post the Decomposition summary comment (CREATED / SKIPPED / FAILED /
   NOT_ATTEMPTED).

Never update the parent, never create in parallel, never decompose without
approval, and never duplicate already-created children.
