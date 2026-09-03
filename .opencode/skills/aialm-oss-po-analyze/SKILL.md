---
name: aialm-oss-po-analyze
description: Analyze ONE READY candidate issue for implementability and propose testable Product AC as plain-English Gherkin plus an execution plan sketch. Use after a candidate is READY to feed the QA/dev pipeline.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-po-analyze

Analyze one READY candidate issue into atomic, human-approvable proposal
comments. Never modifies the candidate description/metadata or the GitHub issue.

## Command

```
/aialm-oss-po-analyze owner/repo#issue
```

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=PO`, `AIALM AGENT=aialm-oss-po-analyze`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals + summary, even if idempotent/semi-skipped):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=PO`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project (for WELLBEINGT: `10102`/`10103`/`10104`). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Flow

1. **Reserve: start transition** — `AWAITING_AGENT_PICKUP → IN_PROGRESS_BY_AGENT` + native `AWAITS AGENT PICKUP → AGENT WORKING` (`jira_jira_get_transitions` + `jira_jira_transition_issue` + `jira_jira_update_issue` for krotka). If the ticket is already `IN_PROGRESS_BY_AGENT`/`AGENT WORKING` for this skill, skip the start transition (idempotent).
2. Load the Project AI Profile + the candidate qualification.
3. Fetch the full issue body/comments via the adapter seam.
4. Gate: if the recommendation is not READY → post exactly one
   `[AI-generated] Blocked — owner/repo#issue` comment and **still do the End transition** (leave in `AWAITING_HUMAN_APPROVAL`/`AWAITS HUMAN APPROVAL` — never `IN_PROGRESS_BY_AGENT`).
5. LLM analyze into findings: `BLOCKING | NON-BLOCKING | CREATIVE`, each with
   a `why` and plain-English Gherkin. Max 2–3 CREATIVE per run.
6. Post one Proposal comment per atomic finding (1 issue = 1 Scenario) — never
   multi-scenario in a single comment.
7. Post a summary comment: BLOCKING/NON-BLOCKING/CREATIVE counts + proposal ids.
8. **Release: end transition** — `IN_PROGRESS_BY_AGENT → AWAITING_HUMAN_APPROVAL` + native `AGENT WORKING → AWAITS HUMAN APPROVAL` (even on idempotent re-run). Do not leave `AGENT WORKING`/`IN_PROGRESS_BY_AGENT` even if all proposals already existed.

## Finding model

```
{
  issue,        // raised issue, plain English
  why,          // why it matters
  gherkin,      // Scenario: Given/When/Then/And
  kind          // BLOCKING | NON-BLOCKING | CREATIVE
}
proposalId = hash(norm(issue + gherkin))
executionSketch { touchedAreas[], riskNotes[], profileConventionFit }
```

## Comment template

```
[AI-generated] Proposal — <KEY> — aialm-oss-po-analyze:<id>
proposal:<id>  (+ creative:<id> if creative)
Raised issue — Why it matters
Proposed acceptance criteria
<pre>Scenario: ...</pre>
AI proposes; a human approves by commenting ✅ (or APPROVE:<id>).
```

## Rules

- **No technical safe defaults** — proposing framework/library/infra choices is
  owned by dev-analyst; raise them as findings, never as defaults.
- Split broad findings; never merge multiple scenarios into one comment.
- CREATIVE proposals still require a human ✅.

## Idempotency

- Skip identical `proposal:<id>` already present on the candidate record.
- A contradictory finding → a Conflict/Clarification Required comment, never a
  silent replace. Never delete existing proposals.

## Tooling / MCP

Allow: adapter reads (Profile, candidate, GitHub issue), comment list/create on
the candidate record; **plus** `jira_jira_search_fields` / `jira_jira_get_transitions` /
`jira_jira_transition_issue` / `jira_jira_update_issue` **only** for the AGENTS.md state pair
(krotka `AIALM STAGE/ROLE/AGENT` + native column `AWAITS AGENT PICKUP`↔`AGENT WORKING`↔`AWAITS HUMAN APPROVAL`).
MUST NOT: workitem create/delete, GitHub writes, or description/issue-type/assignee/fields beyond the state krotka.
