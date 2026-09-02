# WELLBEINGT-174: AIALM V4 — aialm-qa-analyze — QA scenario proposer (/aialm-qa-analyze)

**Traceability:** Approved Product AC → `/aialm-qa-analyze` → QA Proposal comments → `/aialm-qa-update-approved`

**Skill:** `aialm-qa-analyze` | `/aialm-qa-analyze WELLBEINGT-N`

**Principle:** AI proposes → human approves → AI executes. Product AC = what; QA AC = how to verify.

## 1. Goal

Derive testable, behavioral QA scenarios from approved Product AC. Do not modify Product AC. Do not invent business requirements. Do not leak implementation (no SQL, API paths, locators, expect()).

## 2. Exclusive subticket mode

- If functional children exist (`isExclusiveSubticketMode`): analyze each functional child independently; do NOT analyze parent as one feature.

- Sort children deterministically (identifier).

- Parent context + parent Product AC may be supporting context only.

- Child without approved Product AC → BLOCKED for that child (comment), continue others.

- If no functional children: analyze the single target work item.

## 3. Input assembly

retrieve parent, comments, children, each child description/comments, approved Product AC sections, existing QA proposals/reactions. Use aialm-adapter context helpers.

## 4. QA Proposal model

```
`{
 sourceProductAC: string | string[],
 testObjective: string,
 kind: "CORE" | "EDGE" | "CREATIVE",
 scenario: string, // one Gherkin Scenario, behavioral
 coverageHint?: "UI"|"API"|"DATA"|"INTEGRATION"|"E2E", // hint only
 rationale: string,
 proposalId: string // hash(norm(sourceProductAC + testObjective + scenario))
}`
```

N:M Product AC ↔ QA scenarios allowed. Never force 1 Product AC = 1 QA.

## 5. Kind definitions

- **CORE** — necessary to verify Product AC

- **EDGE** — boundary, negative, validation, empty-state

- **CREATIVE** — optional quality refinement; clearly marked; not automatic Product AC

## 6. Gherkin quality (behavioral only)

- Concrete, deterministic, observable, automatable, plain English

- Ban: SQL, concrete endpoints, Playwright/locator syntax, framework asserts

- Prefer: user-visible outcomes and defined application responses

## 7. Comment template

```
`<p><strong>[AI-generated] Proposal — WELLBEINGT-N — aialm-qa-analyze:&lt;id&gt;</strong></p>
<p><em>AI proposes — react ✅|👍 or comment APPROVE:&lt;id&gt; to approve.</em></p>
<h3>QA Scenario Proposal</h3>
<p><code># source:</code> product-ac refs<br>
<code># kind:</code> CORE|EDGE|CREATIVE<br>
<code># objective:</code> test objective</p>
<p><strong>Why:</strong> rationale</p>
<p><em>Coverage hint: UI|API|DATA|INTEGRATION|E2E (hint only)</em></p>
<pre><code>Scenario: ...behavioral Gherkin...</code></pre>
<p><code>proposal:&lt;id&gt;</code></p>
`
```

The h3 title MUST be exactly `QA Scenario Proposal`: `/aialm-qa-update-approved` selects proposals by this heading + the `aialm-qa-analyze:<id>` stamp + matching `proposal:<id>` footer. Product AC proposals share the same envelope but carry title `Product AC Proposal` and stamp `aialm-po-analyze:<id>`; they must never match QA selection.

Place proposals on the analyzed target (subticket or parent). Skill marker MUST be `aialm-qa-analyze`.

## 8. Plane MCP

**Allow:** retrieve, list children (client-side), comment list/create, reaction_list (read).

**MUST NOT:** modify description/state/labels, create functional work items, create test code, execute tests. Optional: create QA placeholder only if this skill owns it — V4 default: placeholder creation deferred to `aialm-qa-update-approved`.

## 9. Idempotency

Skip identical proposalId. Never delete/modify existing proposals.

## 10. Deliverables

- `.opencode/skills/aialm-qa-analyze/SKILL.md`

- `.opencode/commands/aialm-qa-analyze.md`

- `src/service/qa-analyzer.ts` + unit tests

## 11. Acceptance criteria

- Exclusive mode isolates functional children.

- Every CORE/EDGE has one concrete behavioral Gherkin.

- Every proposal traces to Product AC.

- No implementation leakage in scenarios.

- CREATIVE marked and not treated as requirements.

- Idempotent; missing Product AC → BLOCKED per target.

- Skill/command names use `aialm-qa-analyze`.

## 12. Downstream

Approved proposals consumed by `/aialm-qa-update-approved`, which merges them into the analyzed target's own description (V4 has no dedicated QA work items).
