---
name: aialm-oss-po-decompose
description: Turn the latest human-approved decomposition package into real ALM child work items linked to the imported parent. The only skill that creates functional children. Use after a decomposition package is approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-po-decompose

Create real functional child work items from the latest human-approved
`aialm-oss-po-prep-decompose` package. Sequential create, idempotent.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=PO`, `AIALM AGENT=aialm-oss-po-decompose`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=PO`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-po-decompose AIALMOSS-N
```

## Flow

1. **Reserve: start transition** — `AWAITING_AGENT_PICKUP → IN_PROGRESS_BY_AGENT` + native `AWAITS AGENT PICKUP → AGENT WORKING` (`jira_jira_get_transitions` + `jira_jira_transition_issue` + `jira_jira_update_issue` for krotka; idempotent if already `IN_PROGRESS_BY_AGENT` for this skill).
2. Retrieve the parent + comments + reactions + existing children.
3. Find the latest approved `aialm-oss-po-prep-decompose` package
   (`hasHumanApprovalFor`).
4. Validate the package (titles, AC, deps resolvable, acyclic, Profile-fit).
   If invalid → post `Decomposition invalid / BLOCKED` comment and still do step 7 (never leave `IN_PROGRESS_BY_AGENT`).
5. Create children sequentially in dependency order, `parent = parentKey`.
   Use issue type **`Sub-task`** (not `Subtask`) — WELLBEINGT projects use `Sub-task` (`subtask:true`). Description:
   ```
   > **AI-generated from:** AIALMOSS-N (externalSource owner/repo#N)
   Created by /aialm-oss-po-decompose
   ## Goal / ## Scope / ## Acceptance Criteria / ## Dependencies / ## Traceability
   ```
6. Resolve childKey dependencies to created identifiers as you go.
7. Post a summary comment with **routable header** (Option A — required for pickup):
   ```
   [AI-generated] Proposal — <PARENT-KEY> — aialm-oss-po-decompose:<decomposeId>
   proposal:<decomposeId>
   AI-generated Summary — <PARENT-KEY> — aialm-oss-po-decompose
   CREATED: ... / SKIPPED / FAILED / NOT_ATTEMPTED + dependency resolution
   Awaiting human approval of decomposition (subtasks created) — orchestrator will then route to aialm-oss-qa-analyze.
   ```
   `decomposeId` = `packageProposalId` (the approved `po-prep-decompose` package id, 7-12 hex) — reuse it as the decompose marker so `extractProposalIds('aialm-oss-po-decompose')` finds it and `hasHumanApprovalFor(comments, decomposeId)` gates the next pickup. Always include both the header `aialm-oss-po-decompose:<decomposeId>` and footer `proposal:<decomposeId>`.
8. **Release: end transition** — `IN_PROGRESS_BY_AGENT → AWAITING_HUMAN_APPROVAL` (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=PO`, `AIALM AGENT=none`) + native `AGENT WORKING → AWAITS HUMAN APPROVAL` (even on idempotent/failed/blocked — never leave `AGENT WORKING`).

## Idempotency

- Detect an existing child by stable key (`childKey:` / `packageProposal:`
  marker in description); fallback normalized title only if the key is missing.
- Never silently update/delete existing children; preserve unrelated children.

## Partial failure

Report Created A,B; Failed C; Not attempted D — resumable without duplicating
A,B (dependents of a failed child are NOT_ATTEMPTED).

## Tooling / MCP

Allow: retrieve, comment list/create, reaction list, workitem create (children `Sub-task`),
comment create (summary); **plus** `jira_jira_get_transitions`/`jira_jira_transition_issue`/`jira_jira_update_issue` **only** for AGENTS.md state pair (krotka + native column transitions per State transitions above).
MUST NOT: update parent description beyond state krotka, auto-decompose without approval,
bulk parallel create.

## Downstream

Functional children become targets for `/aialm-oss-qa-analyze` exclusive mode.
