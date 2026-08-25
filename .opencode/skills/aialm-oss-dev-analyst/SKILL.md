---
name: aialm-oss-dev-analyst
description: For each functional child with approved Product AC and non-empty GENERATED QA, propose concrete, human-approvable implementation/testability contract details. Use after QA GENERATED exists and before aialm-oss-dev-update-approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-dev-analyst

Propose concrete Implementation Contract details (stable seams/test hooks) so a
human approves the technical contract before implementation. Never modifies
AC / GENERATED QA; writes no code.

## Command

```
/aialm-oss-dev-analyst AIALMOSS-N
```

## Exclusive subticket mode

- Functional children exist → analyze each independently (sorted by identifier);
  skip legacy `QA`-prefixed titles.
- A target without Product AC or without GENERATED QA → `[AI-generated] Blocked`
  on that target; continue the others.
- No children → analyze the single target when it has both.

## Input assembly

- Product AC section; GENERATED QA scenarios (metadata).
- Project AI Profile conventions (coding/testing conventions, structure, CI
  commands) constrain which seams are acceptable in THIS repository.
- Existing codebase is context only — never the requirement.

## Cross-analysis AC ↔ GENERATED QA (MUST)

- UI actions → stable test hooks per Profile test conventions (e.g.
  `data-testid="…"`).
- Observable UI states (confirm open/cancelled, filtered empty, flash
  auto-dismiss).
- API/URL seams implied by Product AC (status outcomes, query params) — no SQL /
  framework asserts.
- Error/ownership outcomes as user-visible or contract-level responses.

## Proposal model

```
{
  sourceProductAC: string[],
  sourceQaRefs?: string[],
  kind: "SEAM" | "LOCATOR" | "API" | "UI-STATE" | "DATA" | "OPEN",
  consumers: ["qa-impl", "dev-impl"],
  title: string,
  body: string,
  profileRefs?: string[],   // which Profile convention justifies the seam
  proposalId: hash(normalize(sources + kind + title + body))
}
```

Envelope: `[AI-generated] Proposal — AIALMOSS-N — aialm-oss-dev-analyst:<id>`,
h3 exactly `Implementation Contract Proposal`, footer `proposal:<id>`. Max 2
optional CREATIVE per run. OPEN/BLOCKING for missing product decisions.

## Quality bar

- Concrete/deterministic (named test ids, states, URL/API outcomes) — enough for
  human approval and for qa-impl to bind without guessing.
- MUST NOT: full source diffs; locator chains as product truth; SQL DDL as AC;
  silent AC changes; seams contradicting Profile conventions (those are
  rejected).

## Tooling / MCP

Allow: retrieve, list children, comment list/create, reaction list (read),
Profile read.
MUST NOT: modify description/state/labels, create work items, write tests/app
code, merge the contract (that is dev-update-approved).

## Idempotency

Skip identical `proposalId`; never delete/modify existing proposals; conflict →
clarification comment, no silent replace.

## Downstream

Approved proposals are consumed by `/aialm-oss-dev-update-approved`, then
qa-impl ∥ dev-impl run in parallel on the frozen contract.
