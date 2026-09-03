---
name: aialm-oss-qa-update-approved
description: Batch human-approved QA proposals into the canonical behavioral GENERATED specification inside each analyzed target's OWN description. Use after QA proposals are approved and before aialm-oss-qa-impl.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-qa-update-approved

Merge approved QA scenarios into the canonical `GENERATED QA` block inside each
analyzed target's own description. No dedicated QA work items; idempotent; never
invents scenarios.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=QA`, `AIALM AGENT=aialm-oss-qa-update-approved`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=QA`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-qa-update-approved AIALMOSS-N
```

## Target resolution

- Exclusive functional children: merge into EACH child independently; never
  cross-merge scenarios across unrelated children.
- No functional children: merge into the target itself.
- Zero approved proposals for a target → unchanged (SKIPPED).

## Selection

Qualifies ONLY if ALL hold:
- heading `QA Scenario Proposal`
- header stamp `aialm-oss-qa-analyze:<id>`
- footer `proposal:<id>` (same id)

MUST ignore Product AC proposals, Candidate Qualification, Import Report and
Work Itemization/summary comments — even with an identical envelope. Approval via
`hasHumanApprovalFor` (✅/👍 or human `APPROVE:`/LGTM). Skip unapproved,
malformed, trash-rejected or duplicate proposals (normalized scenario hash);
missing metadata lines stay lenient (defaults CORE / empty objective).

## GENERATED format (canonical for aialm-oss-qa-impl)

```
<!-- GENERATED QA hash: <hash> -->
# source: ...
# kind: CORE | EDGE | CREATIVE
# objective: ...
Scenario: ... Given/When/Then ...
<!-- END GENERATED QA -->
```

- `hash` = deterministic over the approved scenario set + sources.
- First apply appends the block; later applies replace ONLY the block; manual
  notes and AC outside it are preserved verbatim.
- Identical hash → no write.

## Mutation & tooling

Allow: retrieve, list children, comment list/create, reaction list, workitem
update (target description only), comment create (one summary on the parent).
MUST NOT: create work items, modify Product AC, change state/labels, write test
code.

## Downstream

`GENERATED` is the sole source of truth for `/aialm-oss-qa-impl`.
