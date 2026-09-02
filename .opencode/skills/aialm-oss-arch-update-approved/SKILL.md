---
name: aialm-oss-arch-update-approved
description: Apply approved Architecture Review into the target description (## Architecture Review + ARCH hash).
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (email `aialmoss@icloud.com` — dopasuj po
> `emailAddress`/`accountId`), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.

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
