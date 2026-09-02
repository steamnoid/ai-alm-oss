# WELLBEINGT-205: AIALM V4 — aialm-dev-analyst — Implementation / testability proposer (/aialm-dev-analyst)

**Traceability:** Product AC + GENERATED QA (behavioral) on each functional child → `/aialm-dev-analyst` → Implementation Contract proposals → `/aialm-dev-update-approved` → parallel `/aialm-qa-impl` ∥ `/aialm-dev-impl`

**Skill:** `aialm-dev-analyst` | `/aialm-dev-analyst WELLBEINGT-N`

**Principle:** AI proposes → human approves → AI executes. This skill only proposes.

## 1. Goal

For each functional child that already has approved Product AC and a non-empty GENERATED QA block, analyze both and propose concrete implementation / testability details so that:

- a human can approve the technical contract before AI implements the feature,

- `aialm-qa-impl` knows stable hooks it needs (e.g. `data-testid="…"`), without inventing them ad hoc,

- `aialm-dev-impl` implements the same hooks and seams from the same approved contract.

Does not modify Product AC or GENERATED QA. Does not write application or test code.

## 2. Exclusive subticket mode

- If functional children exist: analyze each functional child independently (not the parent as one feature). Sort by identifier.

- Skip titles starting with `[QA]` (legacy).

- Target without Product AC or without non-empty GENERATED QA → `[AI-generated] Blocked` on that target; continue others.

- If no functional children: analyze the single target when it has both AC and GENERATED.

## 3. Input assembly

- Product AC section (`## Acceptance Criteria`)

- GENERATED QA scenarios (behavioral Gherkin + metadata)

- Optional: existing codebase as context only (do not treat current code as the requirement)

- Parent context for naming/traceability only

## 4. Cross-analysis AC ↔ GENERATED QA (MUST)

For each GENERATED scenario, derive what `aialm-qa-impl` will need to automate it and what `aialm-dev-impl` must expose. Examples:

- UI actions → stable test hooks: prefer `data-testid="…"` (e.g. `event-delete`, `delete-confirm`, `delete-cancel`, `event-select`, `bulk-delete`, `delete-flash`, day/count hooks aligned with existing calendar patterns)

- Observable UI states (confirm open, cancelled, filtered empty, flash auto-dismiss)

- API / URL seams already implied by Product AC (status outcomes, query params) — not SQL or framework asserts in Product AC

- Ownership / error outcomes as user-visible or contract-level responses

Product AC and GENERATED QA remain behavioral. Locators and seams live only in proposals / Implementation Contract after approval.

## 5. Proposal model

```
`{
 sourceProductAC: string[],
 sourceQaRefs?: string[], // optional pointer to GENERATED objective/scenario
 kind: "SEAM" | "LOCATOR" | "API" | "UI-STATE" | "DATA" | "OPEN",
 consumers: ["qa-impl", "dev-impl"], // who needs this detail
 title: string,
 body: string, // concrete enough for human ✅ before AI impl
 proposalId: hash(normalize(sources + kind + title + body))
}`
```

Comment envelope:

```
`[AI-generated] Proposal — WELLBEINGT-N — aialm-dev-analyst:<id>
h3: Implementation Contract Proposal
# source: AC-… | QA: …
# kind: LOCATOR|SEAM|…
# consumers: qa-impl, dev-impl
# objective: …
<pre><code>…contract detail…</code></pre>
proposal:<id>
`
```

Max optional CREATIVE proposals per run: 2 (clearly badged). OPEN/BLOCKING for missing product decisions — never invent business requirements.

## 6. Quality bar for proposals

- Concrete and deterministic (named testids, named states, named URL/API outcomes)

- Enough for a developer to approve AI implementation of the feature

- Enough for `aialm-qa-impl` to bind Playwright without guessing hooks

- MUST NOT: full app/test source diffs; Playwright locator chains as product truth; SQL DDL as Product AC; silent changes to approved AC

## 7. Plane MCP

**Allow:** retrieve, list children, comment list/create, reaction_list (read).

**MUST NOT:** modify description/state/labels, create work items, write tests or app code, merge Implementation Contract (that is `aialm-dev-update-approved`).

## 8. Idempotency

Skip identical `proposalId`. Never delete/modify existing proposals. Conflict → Conflict/Clarification comment, no silent replace.

## 9. Deliverables

- `.opencode/skills/aialm-dev-analyst/SKILL.md`

- `.opencode/commands/aialm-dev-analyst.md`

- Helpers + unit tests for proposal id, exclusive targets, gate on missing AC/GENERATED

## 10. Acceptance criteria

- Exclusive mode isolates functional children.

- Every proposal traces to Product AC and/or GENERATED QA.

- Proposals include testability details needed by qa-impl (e.g. data-testid) when scenarios require UI automation.

- Product AC / GENERATED QA stay free of locator leakage.

- Missing AC or GENERATED → Blocked per target.

- Idempotent; skill name exactly `aialm-dev-analyst`.

## 11. Downstream

Approved proposals consumed by `/aialm-dev-update-approved`. Then `/aialm-qa-impl` and `/aialm-dev-impl` may run in parallel on the frozen Implementation Contract without reading each other's outputs.
