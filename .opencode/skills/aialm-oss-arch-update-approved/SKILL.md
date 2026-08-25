---
name: aialm-oss-arch-update-approved
description: Apply approved Architecture Review into the target description (## Architecture Review + ARCH hash).
---

# aialm-oss-arch-update-approved

Merge human-approved `aialm-oss-arch-analyze` proposals into the target's OWN description.

## Command

```
/aialm-oss-arch-update-approved AIALMOSS-N
```

## Flow

1. Select approved proposals (`aialm-oss-arch-analyze:<id>` + `proposal:<id>` + hasHumanApprovalFor).
2. Build `## Architecture Review` block (`ARCH hash:`) and merge (preserve outside content).
3. Summary; assignee-hygiene.

## Rules / Idempotency

Never invent; never touch AC/GENERATED/contract; no new work items; hash-stable.
