# WELLBEINGT-175: AIALM V4 — aialm-qa-impl — Playwright implementer (/aialm-qa-impl)

**Traceability:** GENERATED QA + approved Implementation Contract on the functional child → `/aialm-qa-impl` → Playwright tests

**Skill:** `aialm-qa-impl` | `/aialm-qa-impl WELLBEINGT-N` (parent or functional child id)

## 1. Goal

Materialize approved GENERATED behavioral QA scenarios into executable Playwright tests using the frozen Implementation Contract for technical hooks (e.g. `data-testid`). Implements intent only — does not design new product tests or change requirements.

## 2. Input

- V4 has NO dedicated QA work items: GENERATED QA lives in EACH functional child's description.

- Resolve target: parent with exclusive functional children → each child independently; or single functional child id.

- Require non-empty GENERATED QA; else BLOCKED for that target.

- When UI automation is required, require non-empty Implementation Contract (GENERATED DEV) with approved locators/seams; if missing → BLOCKED (run `/aialm-dev-analyst` + `/aialm-dev-update-approved` first) rather than inventing testids.

- May read parent context for naming/traceability only.

- MUST NOT read same-wave `aialm-dev-impl` feature diffs as the source of hooks (pre-existing main codebase OK).

## 3. Codebase inspection (before write)

- Playwright installed? config? fixtures? auth helpers? page objects? package scripts?

- Reuse existing infra; create minimal setup only when missing.

## 4. Implementation rules

- Normally 1 GENERATED Scenario → 1 test

- Bind selectors from Implementation Contract exactly (same `data-testid` strings); do not invent alternate hooks when contract defines them

- Traceability: test title `QA: <scenario title> [<functional-child-id>]` and/or `tests/e2e/mapping.ts`

- Business behavior NEVER invented beyond GENERATED + Product AC

- Missing business decision → BLOCKED that scenario; never weaken assertions to pass

- Paths: `tests/e2e/<ticket-or-child-id>/*.spec.ts`

## 5. Parallelism with aialm-dev-impl

- Shared frozen inputs: Product AC, GENERATED QA, Implementation Contract, pre-existing main

- Forbidden: using same-wave app feature files as requirement source instead of the contract

- Battle test: e2e green only if the shared contract was precise enough

## 6. Execution & report

```
`IMPLEMENTED | IMPLEMENTED_WITH_FAILURES | BLOCKED
# counts passed/failed; classify honestly
`
```

Optional summary comment on the functional child — must NOT mark Plane Done or change requirements.

## 7. Idempotency

Detect existing mapped tests; update when GENERATED/contract changed; no duplicate specs; preserve unrelated tests.

## 8. Plane MCP / tools

**Allow:** retrieve, comment list, reaction_list, repo read/write for tests, bash Playwright.

**MUST NOT:** modify Product AC, GENERATED QA, Implementation Contract, proposals, work item state, create work items.

## 9. Deliverables

- `.opencode/skills/aialm-qa-impl/SKILL.md`

- `.opencode/commands/aialm-qa-impl.md`

- Generated tests under `tests/e2e/`; unit tests for plan/mapping

## 10. Acceptance criteria

- Only approved GENERATED scenarios implemented.

- UI hooks taken from Implementation Contract when present; no ad-hoc testid invention that contradicts the contract.

- Every test traceable to source scenario / target id.

- No Plane requirement/metadata mutation.

- Idempotent re-run; skill name exactly `aialm-qa-impl`.

- No cross-read of parallel dev-impl outputs as requirements.

## 11. Downstream

Together with `/aialm-dev-impl`, feeds e2e verification / aialm-e2e-consistency.
