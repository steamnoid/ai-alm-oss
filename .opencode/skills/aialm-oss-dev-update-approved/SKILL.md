---
name: aialm-oss-dev-update-approved
description: Batch human-approved implementation/testability proposals into the canonical ## Implementation Contract section inside each functional child's own description. Use after dev-analyst proposals are approved, before aialm-oss-qa-impl / aialm-oss-dev-impl.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (email `aialmoss@icloud.com` — dopasuj po
> `emailAddress`/`accountId`), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.

# aialm-oss-dev-update-approved

Merge approved Implementation Contract entries into the canonical
`## Implementation Contract` (GENERATED DEV) section inside each analyzed
functional child's own description. Idempotent; never invents contract details;
creates no work items.

## Command

```
/aialm-oss-dev-update-approved AIALMOSS-N
```

## Target resolution

- Exclusive functional children: merge into EACH independently; never
  cross-merge across unrelated children.
- No children: merge into the target itself when applicable; zero approved
  proposals → unchanged (SKIPPED).
- MUST NOT create dedicated contract or QA work items.

## Selection

Qualifies ONLY if ALL hold:
- heading `Implementation Contract Proposal`
- stamp `aialm-oss-dev-analyst:<id>`
- footer `proposal:<id>` (same id)

Ignore AC / QA / Candidate / Import / Itemization / summary comments. Approval via
✅/👍 on the comment or human `APPROVE:`. Skip unapproved, malformed,
trash-rejected or duplicates (body-hash).

## Contract format (canonical for qa-impl & dev-impl)

```
## Implementation Contract
GENERATED DEV hash: <hash>
# kind: ... / # source: ... / # consumers: ... / # profile refs: ...
title: ...
<body>
END GENERATED DEV
```

- Deterministic hash over the entry set.
- First apply appends the section; later applies replace ONLY the region.
- AC, GENERATED QA and manual notes preserved verbatim.
- Identical hash → no write. Sanitizer-proof visible markers always emitted.

## Mutation & tooling

Allow: retrieve, list children, comment list/create, reaction list, workitem
update (target description only), one summary on the parent.
MUST NOT: create work items, modify Product AC / GENERATED QA intent, change
state/labels, write app or test code.

## Downstream

The contract is the shared frozen input for parallel `aialm-oss-qa-impl` and
`aialm-oss-dev-impl` without cross-reading each other's outputs.
