---
description: Propose behavioral QA scenarios (Gherkin) for a work item with approved Product AC
---
Derive QA scenarios from approved Product AC as atomic QA Proposal comments.

Target work item: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-qa-analyze skill (`.opencode/skills/aialm-oss-qa-analyze/SKILL.md`):

1. Detect functional children (via searchJql parent). Exclusive mode: analyze
   each child independently, sorted by identifier; never the parent as one
   feature. No children → single target = parent.
2. For each target, gate on approved Product AC: if missing, post ONE
   [AI-generated] Blocked — <key> comment and continue the others.
3. LLM produces QaProposal[] per target (CORE / EDGE / CREATIVE), each with
   one concrete behavioral Gherkin Scenario + sourceProductAC + objective +
   rationale (+ optional coverageHint). No implementation leakage, CREATIVE
   clearly marked.
4. Post one QA Proposal comment per proposal via analyzeQa (idempotent by
   proposalId; never delete/modify). Post a summary comment on the parent.

Only retrieve and comment — never modify description/state/labels, create work
items, write or execute tests.
