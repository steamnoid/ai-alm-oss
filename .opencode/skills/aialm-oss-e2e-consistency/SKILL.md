---
name: aialm-oss-e2e-consistency
description: Deterministic unit/integration verification suite proving the full governed issue-to-PR workflow and cross-skill contracts, including the external dock, the parallel qa∥dev battle test, and end-to-end traceability. Run after any V1 skill change.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-e2e-consistency

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=AI`, `AIALM AGENT=aialm-oss-e2e-consistency`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=AI`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

Verify the full governed issue-to-PR workflow and cross-skill contracts with
deterministic unit/integration tests. Superset of the V4 `aialm-e2e-consistency`
checks plus OSS traceability checks.

## Scope

- Adapters, onboard, discover, po, qa, dev, verify, pr, feedback helpers
  (`tests/unit/**`).
- Interop sequence tests over the full path incl. the dock + feedback loop
  (`tests/integration/**`).

## Happy path under test

```
repo → onboard (Profile) → discover (candidates)
→ po-analyze → approve → po-update-approved (DOCK: Work Item created)
→ po-prep-decompose → approve → po-decompose (children)
→ qa-analyze (exclusive) → approve → qa-update-approved
→ dev-analyst → approve → dev-update-approved
→ parallel oss-qa-impl ∥ oss-dev-impl on frozen AC + GENERATED QA + Contract
→ verify (evidence) → READY_FOR_PR → pr (trace) → feedback cycle
```

## Failure / edge matrix (must pass)

- Missing approval at any gate → no mutation downstream.
- NEEDS-CLARIFICATION / BLOCKED candidate never imported; no invented info.
- Duplicate import → SKIPPED by externalSource key; malformed markers skipped.
- prep-decompose without AC → BLOCKED; decompose without approved package → no
  create; partial decompose failure resumes without duplicates.
- Exclusive mode isolation; child without AC / GENERATED → blocked per child only.
- impl without contract when hooks needed → BLOCKED; no locators leak into
  GENERATED QA (contract only).
- Idempotent second runs for every mutator; human text preserved verbatim.
- verify: READY_FOR_PR only with all-CORE green evidence; evidence append-only.
- pr: no PR without the approval gate + verdict; single-PR guarantee; body
  contains all mandated elements.
- feedback: SCOPE_CHANGE requires re-approval; zero GitHub writes in the pipeline
  except oss-pr.
- Parallelism mocks assert no same-wave cross-read between qa-impl and dev-impl
  (both directions).

## Interop / ownership

- V1 runs on Jira Cloud as the backend of record (Plane retired to read-only).
- V1 is self-contained (`aialm-oss-*`) but MUST preserve V4 `aialm-*` semantics;
  tests document the mapping and forbid divergent governance rules.
- Approval mocks are comment-based (`APPROVE:`) ONLY (reaction paths retired).
- Every generated PR body asserts the execution-trace link.

## Running

```
npm test
```
