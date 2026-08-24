---
description: Merge approved implementation contract proposals into the canonical ## Implementation Contract section in each target description
---
Apply approved Implementation Contract entries into each analyzed target's own description.

Target work item: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-dev-update-approved skill (`.opencode/skills/aialm-oss-dev-update-approved/SKILL.md`):

1. Resolve targets: exclusive functional children (each independently) or the
   single target when none exist.
2. Per target, collect approved contract entries via collectDevProposals — only
   comments with Implementation Contract Proposal heading + aialm-oss-dev-analyst
   stamp + matching proposal:<id> footer and human approval. Ignore AC / QA /
   Candidate / Import / Itemization / summary.
3. buildTargetMerge: insert/replace the canonical
   ## Implementation Contract section
   (GENERATED DEV hash + # kind/source/consumers/profile refs + body +
   END GENERATED DEV), preserving AC, GENERATED QA and manual notes. Identical
   hash → no write (SKIPPED).
4. updateIssue on the target description only (or BLOCKED on failure); post one
   Implementation Contract summary on the parent (APPLIED / SKIPPED / BLOCKED +
   Malformed).

Never create work items, never modify Product AC / GENERATED QA intent, state or
labels, never write app/test code, and never cross-merge across unrelated
children.
