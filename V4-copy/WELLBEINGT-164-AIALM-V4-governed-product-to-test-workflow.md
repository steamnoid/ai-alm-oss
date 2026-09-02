# WELLBEINGT-164: AIALM V4 — aialm governed product-to-test workflow

# AIALM V4 — aialm governed product-to-test workflow

**Status:** Design — V4 (+ dev path; implementation source of truth)

**Principle:** AI proposes → human approves via click (✅|👍) → AI executes

**Naming:** Every skill, command, and skill folder uses the `aialm-` prefix (e.g. `/aialm-po-analyze`, `.opencode/skills/aialm-po-analyze/`).

## Canonical workflow

```
`Idea ticket
→ /aialm-po-analyze
→ HUMAN APPROVAL (✅|👍 or APPROVE:<id>)
→ /aialm-po-update-approved
→ ## Acceptance Criteria (Product AC)
→ /aialm-po-prep-decompose
→ HUMAN APPROVAL
→ /aialm-po-decompose
→ Functional children
→ /aialm-qa-analyze
→ HUMAN APPROVAL
→ /aialm-qa-update-approved
→ GENERATED QA block on each functional child (behavioral)
→ /aialm-dev-analyst
→ HUMAN APPROVAL
→ /aialm-dev-update-approved
→ ## Implementation Contract (GENERATED DEV) on each functional child
 ↘ ↙
/aialm-qa-impl /aialm-dev-impl
(Playwright; no cross-read) (feature code; no cross-read)
 ↘ ↙
→ e2e / aialm-e2e-consistency (battle test of contract precision)
`
```

## V4 principles

- AI proposes; human approves; only the designated executor mutates data.

- Approved business intent is never silently changed by a later stage.

- Every artifact has deterministic identity (`proposal:<id>`) and traceability.

- Ambiguity becomes explicit BLOCKED — never an invented requirement.

- Each stage is idempotent and preserves unrelated human content.

- QA scenarios (GENERATED QA) are behavioral only (no SQL/API/locator leakage).

- Implementation / testability details (including `data-testid` hooks) live only in `## Implementation Contract` after `aialm-dev-analyst` approval — never in Product AC or GENERATED QA.

- `aialm-qa-impl` and `aialm-dev-impl` may run in parallel on the frozen contract; they MUST NOT use each other's same-wave outputs as requirements (battle test of ALM precision).

- Skill names always use `aialm-` prefix in commands, skills, markers, and ticket titles.

- No dedicated QA work items: approved QA scenarios merge into the analyzed functional target's own description.

## Project constants

- `project_id` = `2ac90835-bce4-4910-9b42-a9e509936ed1` (wellbeing-tracker)

- Identifier forms: `WELLBEINGT-N` | UUID | bare sequence

- Reactions: via `plane-reactions_reaction_list` only (never read `.opencode/reactions.json` directly)

## Children (implementation order)

- `aialm-shared` — shared ALM contract and governance

- `aialm-adapter` — common Plane adapter and WorkItemContext

- `aialm-po-analyze`

- `aialm-po-update-approved`

- `aialm-po-prep-decompose`

- `aialm-po-decompose`

- `aialm-qa-analyze`

- `aialm-qa-update-approved`

- `aialm-dev-analyst` — Implementation / testability proposer (AC + GENERATED QA → proposals, incl. data-testid)

- `aialm-dev-update-approved` — Implementation Contract applier

- `aialm-qa-impl` — Playwright implementer (parallel with dev-impl)

- `aialm-dev-impl` — Feature implementer (parallel with qa-impl)

- `aialm-e2e-consistency` — end-to-end consistency and acceptance tests

## Out of scope / superseded adjacency

`analyst-tech`, `update-approved-tech`, `analyst-impl` are superseded for core delivery by `aialm-dev-analyst`, `aialm-dev-update-approved`, `aialm-dev-impl`. Do not run a second tech-AC channel in parallel without explicit ownership rules. `functionality-dependencies`, `analyst-check-consistency`, `analyst-dep-*` remain adjacent unless redefined.

## Implementation deliverables (from all children)

- `.opencode/skills/aialm-*/SKILL.md`

- `.opencode/commands/aialm-*.md`

- `src/aialm/**` (shared, adapter, po, qa, dev)

- `tests/unit/*`, `tests/e2e/*` (via aialm-qa-impl); app feature code (via aialm-dev-impl)
