---
name: aialm-oss-qa-analyze
description: Derive testable, behavioral QA scenarios from approved Product AC as atomic QA Proposal comments. Exclusive subticket mode when the work item has children. Use after a work item has approved Product AC.
---

# aialm-oss-qa-analyze

Derive behavioral QA scenarios (Gherkin) from approved Product AC. Never modify
Product AC, never invent business requirements, never leak implementation.

## Command

```
/aialm-oss-qa-analyze AIALMOSS-N
```

## Exclusive subticket mode

- If functional children exist: analyze each independently; do NOT analyze the
  parent as one feature; sort by identifier.
- Parent Product AC = supporting context only.
- A child without approved Product AC → BLOCKED for that child (comment);
  continue the other targets.
- No functional children: analyze the single target work item.

## Input assembly

Retrieve parent, comments, children, each child's description/comments, approved
AC sections, existing QA proposals/reactions.

## QA Proposal model

```
{
  sourceProductAC: string | string[],
  testObjective: string,
  kind: "CORE" | "EDGE" | "CREATIVE",
  scenario: string,          // one behavioral Gherkin Scenario
  coverageHint?: "UI"|"API"|"DATA"|"INTEGRATION"|"E2E",
  rationale: string,
  proposalId: string         // hash(norm(sourceProductAC + objective + scenario))
}
```

N:M Product AC ↔ QA scenarios allowed.

## Kinds & Gherkin quality

- CORE = necessary to verify AC; EDGE = boundary/negative/validation/empty-state;
  CREATIVE = optional refinement, clearly marked (never treated as a requirement).
- Concrete, deterministic, observable, automatable, plain English. Ban SQL,
  endpoints, locators, and framework asserts (`expect`, `getBy`, `click(...)`).

## Comment template (selection contract)

```
[AI-generated] Proposal — AIALMOSS-N — aialm-oss-qa-analyze:<id>
QA Scenario Proposal
source: ... / kind: ... / objective: ... / Why: ... / Coverage hint: ...
<pre><code>Scenario: ...</code></pre>
proposal:<id>
```

The QA stamp `aialm-oss-qa-analyze:<id>` + `QA Scenario Proposal` heading +
matching footer id make the comment selectable by qa-update-approved. Product
AC proposals (po-analyze) share the envelope but never match QA selection.

## Tooling / MCP

Allow: retrieve, list children (client-side), comment list/create,
reaction list (read).
MUST NOT: modify description/state/labels, create work items, write or execute
tests.

## Idempotency

Skip identical `proposalId`; never delete/modify existing proposals.
