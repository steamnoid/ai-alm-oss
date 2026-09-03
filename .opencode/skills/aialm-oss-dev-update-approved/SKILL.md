---
name: aialm-oss-dev-update-approved
description: Batch human-approved implementation/testability proposals into the canonical ## Implementation Contract section inside each functional child's own description. Use after dev-analyst proposals are approved, before aialm-oss-qa-impl / aialm-oss-dev-impl.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-dev-update-approved

Merge approved Implementation Contract entries into the canonical
`## Implementation Contract` (GENERATED DEV) section inside each analyzed
functional child's own description. Idempotent; never invents contract details;
creates no work items.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=DEV`, `AIALM AGENT=aialm-oss-dev-update-approved`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=DEV`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

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
