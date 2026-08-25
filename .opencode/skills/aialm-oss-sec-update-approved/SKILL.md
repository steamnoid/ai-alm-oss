---
name: aialm-oss-sec-update-approved
description: Apply approved Security Review into the target description (## Security Review + SEC hash).
---

# aialm-oss-sec-update-approved

Merge human-approved `aialm-oss-sec-analyze` proposals into the target's OWN description.

## Command

```
/aialm-oss-sec-update-approved AIALMOSS-N
```

## Flow

1. Select approved proposals (`aialm-oss-sec-analyze:<id>` + `proposal:<id>` + hasHumanApprovalFor).
2. Build the `## Security Review` block (`SEC hash:`) and merge into the target description (preserve outside content).
3. Summary comment APPLIED/SKIPPED/BLOCKED; assignee-hygiene (unassign when nothing undecided).

## Rules

- Never invent findings; never touch Product AC / GENERATED QA / contract; no new work items.

## Idempotency

Hash-stable; identical hash → no write.
