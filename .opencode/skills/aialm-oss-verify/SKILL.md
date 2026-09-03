---
name: aialm-oss-verify
description: Run the target repository's validation commands against the delivery wave and produce auditable, machine-checkable evidence that the change is PR-ready. Use after aialm-oss-qa-impl / aialm-oss-dev-impl, before aialm-oss-pr.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-verify

Run the target repository's relevant validation commands (from Project AI
Profile) against the delivery wave and produce auditable, machine-checkable
evidence that the change is PR-ready. Never claims successful validation without
executable evidence.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=DEV`, `AIALM AGENT=aialm-oss-verify`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=DEV`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-verify AIALMOSS-N
```

## Flow

1. Resolve work item(s) + wave outputs (feature diff + test specs).
2. Load Profile.ciCommands (typecheck, lint, unit, integration, e2e).
3. Execute commands in order; capture exit codes + logs as `EvidenceEntry[]`
   (via makeEvidence) — append-only, never hidden or silently retried.
4. Run the GENERATED QA suite; map results to scenarios (pass/fail per
   traceability id).
5. Classify per child: PASS | PARTIAL | FAILED | BLOCKED.
6. Persist the evidence summary on the parent (comment) — append-only.
7. PR-readiness verdict: only when ALL CORE scenarios are green →
   READY_FOR_PR.

## Evidence contract

```
EvidenceEntry { stage:"verify", command, artifactRef(logs), result: pass|fail|error, timestamp }
ScenarioResult { scenarioId, testTitle, kind, outcome }
```

No "success" without captured command output.

## Failure handling

- FAILED → report which AC/scenario failed and point to logs; no auto-fix here
  (correction belongs to a governed re-run of the impl skills).
- BLOCKED → missing Profile commands or environment; explicit reason.

## Tooling

Allow: retrieve/comment read-writes (evidence comments), bash execution of
Profile.ciCommands, reading repo state.
MUST NOT: modify code/tests, change ALM item states, open/close PRs, or comment
on GitHub.

## Downstream

A READY_FOR_PR verdict enables `/aialm-oss-pr`.

## V1.2 — executor + CI on PR
`runValidation(Profile.ciCommands)` executes commands via bash and returns EvidenceEntry[] (exit codes + output; result pass|fail|error) — no success claimed without real evidence. PR Actions (`pull_request`) is complementary evidence; READY_FOR_PR only when all CORE green.
