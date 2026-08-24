---
description: Propose a decomposition package (child work items) for one AI-ALM Work Item
---
Propose one decomposition package for a work item with approved Product AC.

Target work item: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-po-prep-decompose skill (`.opencode/skills/aialm-oss-po-prep-decompose/SKILL.md`):

1. Load the parent work item (description + comments + any existing children)
   and the Project AI Profile.
2. Gate: if the parent has no approved `## Acceptance Criteria` section, or the
   package would not be safe to split, post ONE Work Itemization Blocked comment
   and stop — never a fake split.
3. Build a single DecompositionPackage: each child has childKey/title/goal/scope/
   acceptanceCriteria/sourceProductAcRefs/dependencies (optional exclusions &
   profileNotes). Boundaries must respect Profile conventions; deps acyclic;
   cover all parent AC (else report omission/BLOCKED).
4. Post ONE primary proposal comment (marker
   aialm-oss-po-prep-decompose:<packageId>) via prepDecompose — idempotent by
   packageProposalId, never deletes prior proposals.

Only retrieve and comment on the parent record — never create children, update
the parent, assign/estimate, or touch GitHub.
