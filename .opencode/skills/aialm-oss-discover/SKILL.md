---
name: aialm-oss-discover
description: Scan open issues of an onboarded public OSS repo and persist qualified candidates with recommendation labels into its Jira tracking project. Use after onboarding a repo to find candidate work items.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-discover

Scan the public issue space of an onboarded repository and identify candidate
work items with deterministic qualification data.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=PO`, `AIALM AGENT=aialm-oss-discover`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=PO`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-discover owner/repo
```

## Flow

1. Load the Project AI Profile (run `/aialm-oss-project-onboard` first if
   missing → BLOCKED).
2. List open issues (`GithubClient.listOpenIssues`; skips pull requests).
3. For each plausible candidate build a `CandidateIssue` (LLM judgment):
   issue_type, scope, ambiguity, code_localizability, testability,
   dependency_risk, expected_complexity, convention_fit,
   implementation_confidence, recommendation, rationale.
4. Persist via `persistCandidates` → Jira issues labeled `candidate` +
   recommendation, idempotent by the `aialm-external:` marker.
5. Summary comment/report using shared taxonomy:
   CREATED / SKIPPED counts per recommendation.

## Recommendation rules

- `READY` — implementable as-is within Profile conventions
- `NEEDS-CLARIFICATION` — missing info a maintainer would have to answer
- `BLOCKED` — needs credentials/private infra or exceeds complexity/risk threshold
- `UNSUITABLE` — out of scope per Profile restrictions

The agent MUST NOT convert NEEDS-CLARIFICATION or BLOCKED candidates into
executable tasks by inventing missing information.

## Tooling / MCP

Allow: GitHub read via adapter seam, ALM read/write limited to the repo's own
Jira project (candidate issues only). MUST NOT: comment on GitHub, create work
items outside candidate type, write code.
