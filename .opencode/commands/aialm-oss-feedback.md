---
description: Classify maintainer PR feedback into governed correction records
---
Process maintainer PR review feedback into classified ALM records.

Target: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-feedback skill (`.opencode/skills/aialm-oss-feedback/SKILL.md`):

1. Fetch PR review comments via the adapter (PullRequestTrace → prUrl).
2. Classify each comment via classifyComment (CLARIFICATION | BUG |
   MISSING_TEST | STYLE | ARCHITECTURE | SCOPE_CHANGE | BLOCKER) and compute
   the disposition via dispositionFor.
3. For each NEW comment (idempotent by feedbackRef / isRecorded), post one
   Feedback Record comment with category + planned action + approval badge.
   SCOPE_CHANGE / BLOCKER require renewed human approval (needsApproval).
4. Propose AccessGrant for maintainer visibility requests (accessGrantComment)
   and route approved corrections through the standard pipeline skills.
5. Append evidence and update the PR trace.

MUST NOT post to GitHub, modify code/tests directly, or change ALM item states.
No autonomous replies to maintainers; no silent requirement rewrites.
