---
name: aialm-oss-qa-impl
description: Materialize approved GENERATED behavioral scenarios into executable tests in the target OSS repository, using the frozen Implementation Contract for technical hooks. Use after aialm-oss-qa-update-approved and aialm-oss-dev-update-approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-qa-impl

Materialize approved GENERATED behavioral scenarios into executable tests in the
TARGET OSS repository. Implements intent only — never designs new product tests
or changes requirements.

## Command

```
/aialm-oss-qa-impl AIALMOSS-N
```

## Input

- Resolve target: parent with exclusive functional children → each
  independently; or a single child id.
- Require non-empty GENERATED QA; else BLOCKED for that target.
- UI automation required → require a non-empty Implementation Contract with
  approved hooks; missing → BLOCKED (run dev-analyst then
  dev-update-approved first) rather than inventing hooks.
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
