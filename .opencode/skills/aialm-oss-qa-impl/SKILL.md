---
name: aialm-oss-qa-impl
description: Materialize approved GENERATED behavioral scenarios into executable tests in the target OSS repository, using the frozen Implementation Contract for technical hooks. Use after aialm-oss-qa-update-approved and aialm-oss-dev-update-approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-qa-impl

Materialize approved GENERATED behavioral scenarios into executable tests in the
TARGET OSS repository. Implements intent only — never designs new product tests
or changes requirements.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=QA`, `AIALM AGENT=aialm-oss-qa-impl`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=QA`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-qa-impl AIALMOSS-N
```

## Input — source of truth (description OR approved comments)

GENERATED QA and Implementation Contract are canonical when batched into the target
description (`## GENERATED QA` / `## Implementation Contract`). **But approved
proposal comments are an equally valid source of truth** — the skills also read from
comments, so a missing description section does **not** mean the input is absent.

Resolve the effective spec for each target in this order:

0. **Recognizing human approval (comments as source of truth).** A proposal is
   human-approved if **any** of these holds — do not require the `## GENERATED`
   description section:
   - a human `✅`/`👍` reaction on the proposal comment, or
   - a human comment containing `APPROVE:<id>` / `LGTM <id>` (even as a separate
     comment), or
   - a standalone human comment whose body is just `✅` / `👍` appearing **after**
     the proposal in the thread (the human clicked-✅ as a follow-up comment —
     this is approval, not a proposal). A `✅`/`👍` appears as its own comment
     body when the UI posts it as a reply rather than a reaction.
   An unapproved proposal is skipped; a `✅`/`👍` that appears *before* the
   proposal does not count for it.

1. **GENERATED QA**:
   - Prefer the `## GENERATED QA` block in the target description if present.
   - Else derive from **approved `QA Scenario Proposal` comments** on that target:
     header stamp `aialm-oss-qa-analyze:<id>` + footer `proposal:<id>` + human
     approval (`hasHumanApprovalFor`: `✅`/`👍` or `APPROVE:<id>`/LGTM). Each
     approved proposal's `Scenario: ... Given/When/Then ...` + `kind` + `objective`
     is a valid behavioral scenario. Skip unapproved deltas.
   - Only BLOCKED for a target if **neither** a `## GENERATED QA` section **nor** at
     least one approved QA Scenario Proposal comment is present.

2. **Implementation Contract**:
   - Prefer the `## Implementation Contract` block in the target description if
     present.
   - Else derive from **approved `Implementation Contract Proposal` comments** on
     that target: header stamp `aialm-oss-dev-analyst:<id>` + footer
     `proposal:<id>` + human approval. Approved `kind: LOCATOR`/`kind: UI-STATE`/
     `kind: DATA` hooks are the frozen technical hooks for test binding.
   - Only BLOCKED for UI-automation-required targets if **neither** a contract
     section **nor** an approved Implementation Contract Proposal comment is present.
- Resolve target: parent with exclusive functional children → each
  independently; or a single child id.
- Test framework/runner/layout from Project AI Profile testing conventions.
- MUST NOT read same-wave `aialm-oss-dev-impl` diffs as hook source (pre-existing
  main codebase is fine).

## Codebase inspection (before write, in the target repo clone)

- Test framework installed? config? fixtures? helpers? scripts per
  Profile.ciCommands?
- Reuse existing infra; minimal setup only when genuinely missing and
  Profile-compatible.

## Implementation rules

- Normally 1 GENERATED Scenario → 1 test; bind selectors/seams from the contract
  exactly; no alternate hooks when the contract defines them.
- Traceability: test title `QA: <name>` and/or a mapping file.
- Business behavior never invented beyond GENERATED + Product AC; a missing
  decision → BLOCKED that scenario; never weaken assertions to pass.
- Paths follow Profile structure/conventions.

## Parallelism with aialm-oss-dev-impl

- Shared frozen inputs only: Product AC, GENERATED QA, Implementation Contract,
  pre-existing main.
- Forbidden cross-read of same-wave outputs as requirements; e2e green proves
  contract precision (battle test).

## Execution & report

```
IMPLEMENTED | IMPLEMENTED_WITH_FAILURES | BLOCKED
```

Run via Profile validation commands where applicable; classify honestly via
planTests/classifyPlan.

## Idempotency

Detect existing mapped tests by traceability markers; update when GENERATED or
contract changed; no duplicate specs; preserve unrelated tests.

## Tooling

Allow: retrieve/comment/reaction reads, target-repo read/write for tests, bash
for running the test suite.
MUST NOT: modify AC / QA / contract / proposals, work item state, create work
items, or touch GitHub PR state.

## V1.2 — fork feature branch
Write tests on the FORK feature branch (`branchForWave` = aialm-oss/<repo>-<issue#>-<waveKey7>), after `syncFork` (fetch upstream → reset base → rebase); push via `httpsPushUrl` (token). NEVER touch upstream main. Agent performs repo writes; helpers plan/classify.
Each wave works in its own isolated fork clone (`cloneWave` → `.work/<waveKey>/`) so parallel waves never share a working copy.
