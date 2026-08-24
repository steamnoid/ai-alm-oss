---
description: Merge approved QA proposals into the canonical GENERATED block in each target description
---
Apply approved QA proposals into each analyzed target's own description.

Target work item: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-qa-update-approved skill (`.opencode/skills/aialm-oss-qa-update-approved/SKILL.md`):

1. Resolve targets: exclusive functional children (each independently) or the
   single target when none exist.
2. Per target, collect approved QA proposals via collectQaProposals — only
   comments with QA Scenario Proposal heading + aialm-oss-qa-analyze stamp +
   matching proposal:<id> footer and human approval. Ignore Product AC /
   Candidate Qualification / Import Report / Work Itemization / summary.
3. buildTargetMerge: insert/replace the canonical GENERATED block
   (<!-- GENERATED QA hash: <hash> --> + # source/kind/objective + Gherkin +
   <!-- END GENERATED QA -->), preserving manual notes and AC outside it.
   Identical hash → no write (SKIPPED).
4. updateIssue on the target description only (or BLOCKED on failure); post one
   QA GENERATED summary on the parent (APPLIED / SKIPPED / BLOCKED + Malformed).

Never create work items, never modify Product AC, state/labels, or write test
code, and never cross-merge scenarios across unrelated children.
