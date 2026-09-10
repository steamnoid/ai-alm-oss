---
name: aialm-oss-qa-analyze
description: Derive testable, behavioral QA scenarios from approved Product AC as atomic QA Proposal comments. Exclusive subticket mode when the work item has children. Use after a work item has approved Product AC.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-qa-analyze

Derive behavioral QA scenarios (Gherkin) from approved Product AC. Never modify
Product AC, never invent business requirements, never leak implementation.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=QA`, `AIALM AGENT=aialm-oss-qa-analyze`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=QA`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-qa-analyze AIALMOSS-N
```

## Exclusive subticket mode

- If functional children exist: analyze each independently; do NOT analyze the
  parent as one feature; sort by identifier.
- Parent Product AC = supporting context only.
- A child without approved Product AC → BLOCKED for that child (comment);
  continue the other targets.
- No functional children: analyze the single target work item.

## Input assembly — source of truth (description OR approved comments)

Retrieve parent, comments, children, each child's description/comments, approved
AC sections, existing QA proposals/reactions. **Comments are as valid as the
description**: if `## Product AC` is missing from a child's description, derive
it from approved `aialm-oss-po-analyze:<id>` / `aialm-oss-po-update-approved:<id>`
proposals (footer `proposal:<id>`, human-approved by `✅`/`👍` reaction,
`APPROVE:<id>`/`LGTM`, or a standalone `✅`/`👍` comment after the proposal).
Skip unapproved proposals. Paginate comments (`comment_limit:200`) so late `✅`
approvals are not missed.

## QA Proposal model

```
{
  sourceProductAC: string | string[],
  testObjective: string,
  kind: "CORE" | "EDGE" | "CREATIVE",
  scenario: string,          // one behavioral Gherkin Scenario
  coverageHint?: "UI"|"API"|"DATA"|"INTEGRATION"|"E2E",
  rationale: string,
  proposalId: string         // hash(norm(sourceProductAC + objective + scenario))
}
```

N:M Product AC ↔ QA scenarios allowed.

## Kinds & Gherkin quality

- CORE = necessary to verify AC; EDGE = boundary/negative/validation/empty-state;
  CREATIVE = optional refinement, clearly marked (never treated as a requirement).
- Concrete, deterministic, observable, automatable, plain English. Ban SQL,
  endpoints, locators, and framework asserts (`expect`, `getBy`, `click(...)`).

## Comment template (selection contract)

```
[AI-generated] Proposal — AIALMOSS-N — aialm-oss-qa-analyze:<id>
QA Scenario Proposal
source: ... / kind: ... / objective: ... / Why: ... / Coverage hint: ...
<pre><code>Scenario: ...</code></pre>
proposal:<id>
```

The QA stamp `aialm-oss-qa-analyze:<id>` + `QA Scenario Proposal` heading +
matching footer id make the comment selectable by qa-update-approved. Product
AC proposals (po-analyze) share the envelope but never match QA selection.

## Tooling / MCP

Allow: retrieve, list children (client-side), comment list/create,
reaction list (read).
MUST NOT: modify description/state/labels, create work items, write or execute
tests.

## Verify feedback — delta SPEC on demand

When `WELLBEINGT-5` last `aialm-oss-verify` on `W5` is `NOT READY_FOR_PR` and `W13` Light `7f28` failed due to SPEC mismatch (not code `transition-colors`), `qa-analyze` MUST read that `verify` summary from `W5` `comments` and `W13` `GENERATED QA` from `W13` `description`, then call `shared/git-ops:parseVerifyFailure(verifyBody, qaBody)` to decide `fixTarget=spec`. In that case propose delta `aialm-oss-qa-analyze:<newId>` on `W13` (`expect.poll`/`waitForTimeout` vs `toContain`) and wait for `APPROVE:<newId>` before `qa-impl` touches `aialm/wellbeingt-5`.

## Idempotency

Skip identical `proposalId`; never delete/modify existing proposals.
