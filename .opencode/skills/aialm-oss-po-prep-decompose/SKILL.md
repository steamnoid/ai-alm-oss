---
name: aialm-oss-po-prep-decompose
description: Propose how to split one sufficiently specified AI-ALM Work Item into independently implementable functional children (a single decomposition package). Does not create work items. Use after a work item has approved Product AC.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-po-prep-decompose

Propose a single decomposition package for one AI-ALM Work Item. Never creates
children — the human approves the package first.

## Command

```
/aialm-oss-po-prep-decompose AIALMOSS-N
```

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=PO`, `AIALM AGENT=aialm-oss-po-prep-decompose`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (via `jira_jira_get_transitions` → `jira_jira_transition_issue`).
- **End (after proposal/block, even if idempotent):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=PO`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.

To mutate self-aware fields you need their project-correct custom-field ids: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect returned issue fields for keys containing `AIALM STAGE/ROLE/AGENT` values for THIS issue  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**), then `jira_jira_update_issue`. For native status: `jira_jira_get_transitions` → pick `to.name` `AGENT WORKING`/`AWAITS HUMAN APPROVAL` → `jira_jira_transition_issue`.

## Preconditions

- Target has approved Product AC (in its description `## Acceptance Criteria` OR in approved `aialm-oss-po-analyze` proposal comments with human ✅/APPROVE) OR block with a clear reason.
- Project AI Profile present — conventions inform boundary drawing.
- Assemble parent description + comments + any existing children.

## Output model — single package

```
{
  childKey: string,               // stable id inside package
  title: string,
  goal: string,                   // plain English
  scope: string[],
  exclusions?: string[],
  acceptanceCriteria: string[],   // Gherkin-ready subset of parent AC
  sourceProductAcRefs: string[],
  dependencies: string[],         // other childKeys or external refs
  profileNotes?: string[]         // convention constraints from Profile
}
packageProposalId = hash(norm(package payload))
```

One primary proposal comment
`[AI-generated] Proposal — AIALMOSS-N — aialm-oss-po-prep-decompose:<packageId>`
containing all child specs for a single human approval.

## Quality rules

- Preserve explicit requirements; never invent business logic.
- Cover ALL parent Product AC, or report omission / BLOCKED.
- Coherent boundaries; acyclic dependencies; explicit ordering; respect Profile
  structure/conventions when drawing boundaries.
- If it cannot be split safely → post a Work Itemization Blocked comment; no fake
  split.

## Flow (with transitions)

1. **Reserve: start transition** — `AWAITING_AGENT_PICKUP → IN_PROGRESS_BY_AGENT` + native `AWAITS AGENT PICKUP → AGENT WORKING` (idempotent if already `IN_PROGRESS` for this skill).
2. Load Project AI Profile, parent description, comments, children — assemble AC from description OR approved `po-analyze` proposals.
3. Preconditions gate: if no approved AC and cannot assemble, post Work Itemization Blocked comment and still do End transition to `AWAITING_HUMAN_APPROVAL` (never leave `IN_PROGRESS`).
4. Propose single decomposition package (or Blocked) — one primary proposal comment `aialm-oss-po-prep-decompose:<packageId>`.
5. **Release: end transition** — `IN_PROGRESS → AWAITING_HUMAN_APPROVAL/PO/none` + native `AGENT WORKING → AWAITS HUMAN APPROVAL` (even on idempotent re-run).

## Tooling / MCP

Allow: retrieve, comment list/create; **plus** `jira_jira_search_fields`/`jira_jira_get_transitions`/`jira_jira_transition_issue`/`jira_jira_update_issue` **only** for the AGENTS.md state pair (krotka `AIALM STAGE/ROLE/AGENT` + native columns).
MUST NOT: create children (only package proposal), update parent description beyond state krotka, assign/estimate.

## Idempotency

- Skip if an identical `packageProposalId` is already present.
- Never delete prior proposals; no duplicate packages with the same normalized
  payload.

## Downstream

Only the human-approved package is executable by `/aialm-oss-po-decompose`.
