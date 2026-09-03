---
name: aialm-oss-dev-analyst
description: For each functional child with approved Product AC and non-empty GENERATED QA, propose concrete, human-approvable implementation/testability contract details. Use after QA GENERATED exists and before aialm-oss-dev-update-approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-dev-analyst

Propose concrete Implementation Contract details (stable seams/test hooks) so a
human approves the technical contract before implementation. Never modifies
AC / GENERATED QA; writes no code.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=DEV`, `AIALM AGENT=aialm-oss-dev-analyst`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=DEV`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-dev-analyst AIALMOSS-N
```

## Exclusive subticket mode

- Functional children exist → analyze each independently (sorted by identifier);
  skip legacy `QA`-prefixed titles.
- A target without Product AC or without GENERATED QA → `[AI-generated] Blocked`
  on that target; continue the others.
- No children → analyze the single target when it has both.

## Input assembly

- Target description + comments; Product AC section; GENERATED QA scenarios (metadata).
- Project AI Profile conventions (coding/testing conventions, structure, CI
  commands) constrain which seams are acceptable in THIS repository.
- Existing codebase is context only — never the requirement.

## Cross-analysis AC ↔ GENERATED QA (MUST)

- UI actions → stable test hooks per Profile test conventions (e.g.
  `data-testid="…"`).
- Observable UI states (confirm open/cancelled, filtered empty, flash
  auto-dismiss).
- API/URL seams implied by Product AC (status outcomes, query params) — no SQL /
  framework asserts.
- Error/ownership outcomes as user-visible or contract-level responses.

## Proposal model

```
{
  sourceProductAC: string[],
  sourceQaRefs?: string[],
  kind: "SEAM" | "LOCATOR" | "API" | "UI-STATE" | "DATA" | "OPEN",
  consumers: ["qa-impl", "dev-impl"],
  title: string,
  body: string,
  profileRefs?: string[],   // which Profile convention justifies the seam
  proposalId: hash(normalize(sources + kind + title + body))
}
```

Envelope: `[AI-generated] Proposal — AIALMOSS-N — aialm-oss-dev-analyst:<id>`,
h3 exactly `Implementation Contract Proposal`, footer `proposal:<id>`. Max 2
optional CREATIVE per run. OPEN/BLOCKING for missing product decisions.

## Quality bar

- Concrete/deterministic (named test ids, states, URL/API outcomes) — enough for
  human approval and for qa-impl to bind without guessing.
- MUST NOT: full source diffs; locator chains as product truth; SQL DDL as AC;
  silent AC changes; seams contradicting Profile conventions (those are
  rejected).

## Tooling / MCP

Allow: retrieve (description + comments), list children, comment list/create, reaction list (read),
Profile read.
MUST NOT: modify description/state/labels, create work items, write tests/app
code, merge the contract (that is dev-update-approved).

## Idempotency

Skip identical `proposalId`; never delete/modify existing proposals; conflict →
clarification comment, no silent replace.

## Downstream

Approved proposals are consumed by `/aialm-oss-dev-update-approved`, then
qa-impl ∥ dev-impl run in parallel on the frozen contract.
