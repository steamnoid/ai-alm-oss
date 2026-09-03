---
name: aialm-oss-po-update-approved
description: Convert an approved external candidate into a real, governed AI-ALM Work Item (DOCK external → internal) with approved Product AC and full externalSource traceability. Use after a po-analyze proposal is human-approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-po-update-approved

The only skill that turns an approved candidate into a governed AI-ALM Work Item.
Single import per run; idempotent by `owner/repo#N`.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=PO`, `AIALM AGENT=aialm-oss-po-update-approved`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=PO`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-po-update-approved owner/repo#issue
```

## Flow

1. Load the candidate record + its comments + reactions.
2. Select approved po-analyze proposals (`hasHumanApprovalFor`).
3. If no approved proposal → BLOCKED (import gate not passed); post one Import
   Report comment and stop.
4. Upgrade the candidate record **in place** into the governed AI-ALM Work Item
   (same ticket — no new issue; full traceability preserved):
   - description = existing qualification + `## Acceptance Criteria` from approved set
   - `externalSource = { github, owner/repo#N, url }` + `aialm-external:` marker
   - labels: keep `candidate` + add `work-item`
5. Assignee-hygiene: after a successful run (CREATED or SKIPPED), if no proposal
   remains undecided, clear the assignee (unassign).
6. Post an Import Report comment: CREATED / SKIPPED / FAILED / NOT_ATTEMPTED rows.

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
