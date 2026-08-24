---
description: Import an approved external candidate into a governed AI-ALM Work Item (DOCK external → internal)
---
Import one approved candidate into a real AI-ALM Work Item.

Target candidate: $ARGUMENTS (owner/repo#issue)

Execute the aialm-oss-po-update-approved skill (`.opencode/skills/aialm-oss-po-update-approved/SKILL.md`):

1. Load the candidate record + comments + reactions.
2. Select approved po-analyze proposals via hasHumanApprovalFor.
3. If no approved proposal → post an Import Report comment with a BLOCKED row
   and stop.
4. Otherwise create exactly one AI-ALM Work Item via importWorkItem: title =
   external title; description = human summary + ## Acceptance Criteria from
   the approved set; externalSource = { github, owner/repo#N, url } +
   aialm-external marker.
5. Post the Import Report comment (CREATED or SKIPPED row) on the candidate
   record.

Never duplicate (dedupe by owner/repo#N), never invent AC, and only create the
item once per run — no ALM state/priority changes, no GitHub writes.
