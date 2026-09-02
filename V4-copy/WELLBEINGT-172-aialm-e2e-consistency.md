# WELLBEINGT-172: AIALM V4 — aialm-e2e-consistency — end-to-end consistency and acceptance tests

**Traceability:** All aialm-* V4 skills (po/qa/dev) → `aialm-e2e-consistency` verification suite

**Package:** `aialm-e2e-consistency` (test epic)

## 1. Goal

Prove the full governed workflow and cross-skill contracts with deterministic unit/integration tests so implementation AI cannot ship broken interop — including the parallel qa-impl ∥ dev-impl battle test on a frozen Implementation Contract.

## 2. Happy path fixture

```
`idea → aialm-po-analyze → approve → aialm-po-update-approved
→ aialm-po-prep-decompose → approve → aialm-po-decompose
→ aialm-qa-analyze (exclusive children) → approve → aialm-qa-update-approved
→ aialm-dev-analyst → approve → aialm-dev-update-approved
→ (parallel) aialm-qa-impl ∥ aialm-dev-impl on frozen Product AC + GENERATED QA + Implementation Contract
→ Playwright run / consistency report
`
```

## 3. Failure / edge matrix (must have tests)

- Missing approval → no description/children/GENERATED/contract mutation

- Malformed proposal markers → skipped, not applied

- MISSING BLOCKING gate on aialm-po-analyze

- prep-decompose without Product AC → BLOCKED

- decompose without approved package → no create

- partial decompose failure resume without duplicates

- exclusive QA/dev mode isolation; no parent mega-analysis when children exist

- child without Product AC or without GENERATED → QA/dev analyst BLOCKED for that child only

- dev-impl / qa-impl without Implementation Contract when UI hooks required → BLOCKED

- idempotent second runs for every mutator

- human text outside AC/GENERATED QA/Implementation Contract preserved

- behavioral leakage regression: GENERATED QA must not contain SQL/locator mandates

- locators appear only in Implementation Contract after approval

- skill markers always `aialm-*` prefix

- reactions via reaction_list API path (mock), not local file

- parallelism: mock that qa-impl does not require reading same-wave dev-impl files (and reverse)

## 4. Interop / ownership

`analyst-tech` / `update-approved-tech` / `analyst-impl` are superseded by `aialm-dev-*` for core delivery. Tests document MUST NOT dual-channel tech-AC. Other adjacent dep skills remain non-core unless redefined.

## 5. Deliverables

- `tests/unit/*` for adapters, approval, AC/QA/DEV merge, exclusive mode, decomposer filters

- Interop / sequence tests for full aialm V4 path including dev-analyst → parallel impl

- Optional integration harness with mock Plane client

## 6. Acceptance criteria

- Happy path produces expected artifacts in order with correct aialm markers (including Implementation Contract).

- Each stage rejects wrong input/missing approval without unsafe writes.

- Cross-stage proposal ids and source links remain traceable.

- Repeated execution stable; no duplicates.

- Failure classification does not cause silent data loss or requirement changes.

- Behavioral QA contract enforced (no SQL/locator leakage in GENERATED QA builders).

- Battle-test fixtures assert shared frozen inputs for parallel qa-impl and dev-impl.
