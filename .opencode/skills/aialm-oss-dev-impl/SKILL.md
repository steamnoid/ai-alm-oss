---
name: aialm-oss-dev-impl
description: Materialize approved Product AC and Implementation Contract into application feature code in the target OSS repository, under a frozen contract shared with aialm-oss-qa-impl. Use after aialm-oss-dev-update-approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-dev-impl

Materialize approved Product AC and Implementation Contract into application code
for the feature in the TARGET OSS repository. Runs in parallel with
`aialm-oss-qa-impl` under the frozen contract.

## Command

```
/aialm-oss-dev-impl AIALMOSS-N
```

## Input

- Resolve target: parent with exclusive functional children → each
  independently; or a single child id.
- Require per processed target: approved Product AC; non-empty GENERATED QA
  (intent alignment only); non-empty Implementation Contract with hooks when UI
  is in scope.
- Coding style/structure/scripts from Project AI Profile; missing contract →
  BLOCKED for that target.

## Codebase inspection (before write)

- App structure, patterns, auth, API routes, components, libs, unit tests,
  typecheck/lint commands — all per Profile.
- Reuse existing infrastructure; never invent parallel stacks.

## Implementation rules

- Implement AC behaviors; wire every approved locator/seam exactly (same hook
  strings).
- Technical structure follows Profile conventions; business behavior NEVER
  invented beyond AC + contract.
- Missing business decision → BLOCKED that slice; never weaken product behavior
  to make tests pass.
- MUST NOT: edit GENERATED QA intent / Product AC / Implementation Contract;
  create ALM work items; mark Done; read or rewrite same-wave `qa-impl` specs
  (`tests/***`) as source of truth (public pre-existing helpers are OK).

## Parallelism

- Shared inputs only; forbidden cross-read in both directions; e2e green only if
  the shared contract was precise enough (battle test).

## Verification & report

```
IMPLEMENTED | IMPLEMENTED_WITH_FAILURES | BLOCKED
```

Run Profile typecheck/lint/unit commands as applicable; classify honestly via
planImpl/classifyImpl.

## Idempotency

Re-run updates the same feature areas when AC/contract changed; no duplicate
parallel implementations; preserve unrelated code.

## Tooling

Allow: retrieve/comment/reaction reads, target-repo read/write for app code,
bash for typecheck/lint/unit.
MUST NOT: modify AC / QA / contract intent, work item state/priority, create
work items, open PRs.

## V1.2 — fork feature branch
Write feature code on the FORK feature branch (`branchForWave`), after `syncFork`; push via `httpsPushUrl`. NEVER touch upstream main. Agent performs repo writes; helpers plan/classify (HOOK/AC slices).
Each wave works in its own isolated fork clone (`cloneWave` → `.work/<waveKey>/`) so parallel waves never share a working copy.
