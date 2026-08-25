---
name: aialm-oss-e2e-consistency
description: Deterministic unit/integration verification suite proving the full governed issue-to-PR workflow and cross-skill contracts, including the external dock, the parallel qa∥dev battle test, and end-to-end traceability. Run after any V1 skill change.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-e2e-consistency

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
