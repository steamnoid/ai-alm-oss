---
name: aialm-oss-po-update-approved
description: Convert an approved external candidate into a real, governed AI-ALM Work Item (DOCK external → internal) with approved Product AC and full externalSource traceability. Use after a po-analyze proposal is human-approved.
---

# aialm-oss-po-update-approved

The only skill that turns an approved candidate into a governed AI-ALM Work Item.
Single import per run; idempotent by `owner/repo#N`.

## Command

```
/aialm-oss-po-update-approved owner/repo#issue
```

## Flow

1. Load the candidate record + its comments + reactions.
2. Select approved po-analyze proposals (`hasHumanApprovalFor`).
3. If no approved proposal → BLOCKED (import gate not passed); post one Import
   Report comment and stop.
4. Create exactly one AI-ALM Work Item in the ALM project:
   - title = external issue title (normalized)
   - description = human summary + `## Acceptance Criteria` from approved set
   - `externalSource = { github, owner/repo#N, url }` + `aialm-external:` marker
5. Post an Import Report comment: CREATED / SKIPPED / FAILED / NOT_ATTEMPTED rows.

## Selection & mutation rules

- Include only well-formed proposals carrying both `aialm-oss-po-analyze:` and
  `proposal:` markers with human approval.
- Skip unapproved / malformed / trash-rejected (🗑️) / duplicate proposals
  (normalized Gherkin hash). Never invent AC.
- Deterministic AC order (by proposal id); preserve human text verbatim.
- If an AI-ALM Work Item already exists for this `owner/repo#N` → SKIPPED
  (never duplicate). Re-run on unchanged record applies 0.

## Tooling / MCP

Allow: workitem create (exactly one), comment list/create, reaction list.
MUST NOT: modify GitHub state, change state/priority of the created item beyond
defaults, create children.
