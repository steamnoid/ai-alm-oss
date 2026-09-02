# WELLBEINGT-170: AIALM V4 — aialm-adapter — Plane adapter and WorkItemContext

**Traceability:** aialm-shared → aialm-adapter → all aialm skills (po/qa/dev)

**Status:** Design — V4 (+ Implementation Contract)

**Package:** `aialm-adapter` in `src/aialm/adapter/*` + context assembly

## 1. Goal

Provide the shared runtime adapter so every `aialm-*` skill assembles context, classifies children, parses AC / GENERATED QA / Implementation Contract, builds comments, and applies idempotent description merges the same way.

## 2. Types (required)

```
`WorkItemSnapshot { id, identifier, title, descriptionHtml, descriptionText, state, priority, labels, type, parent, relations, deleted_at?, archived_at? }
Comment { id, bodyHtml, bodyText, reactions?: {emoji, userId}[] }
SubtaskContext { workItem, comments }
WorkItemContext { workItem, comments, subtasks }
`
```

## 3. Context assembly

- `retrieve` / `retrieve_by_identifier` parent

- `list comments` parent

- `list` project work items → filter `parent == workItem.id`

- list comments for each direct child

- `plane-reactions_reaction_list` → enrich reactions

## 4. Child classification

- Legacy QA title prefix `[QA]` still recognized if present; V4 does not create such children

- `isFunctionalSubtask`: has parent and not legacy QA

- `isExclusiveSubticketMode` = functional children length > 0

## 5. Product AC helpers

- `extractHumanAndAcSections`, `buildAcMarkdown`, `shouldUpdateDescriptionAc`, AC update summaries

## 6. QA helpers (behavioral V4)

- GENERATED QA parse/render/split with sanitizer-proof visible markers

- Behavioral-only leakage checks for GENERATED QA content

- No create-if-missing QA work items

## 7. Implementation Contract helpers (NEW)

- Parse/render/split `## Implementation Contract` / GENERATED DEV region (dual markers like QA)

- Extract approved locator/seam entries for consumers `qa-impl` and `dev-impl`

- Idempotent merge preserving Product AC + GENERATED QA + human notes outside the region

- Summary builder: `[AI-generated] Update Approved Implementation Contract`

## 8. Proposal builders

- `buildProposalComment(identifier, skill, proposalId, title, bodyHtml, opts)` — skill includes `aialm-dev-analyst`

- Headings: `Product AC Proposal`, `QA Scenario Proposal`, `Implementation Contract Proposal`

- Gating helpers for MISSING BLOCKING as used by po-analyze / dev-analyst

## 9. MUST change vs legacy smells

No SQL/DELETE as product QA intent. Locators belong in Implementation Contract after human approval, not in Product AC or GENERATED QA. Drop dead helpers that create `[QA]` children.

## 10. Deliverables

- `src/aialm/adapter/*`, shared markers, context assembly

- Unit tests: AC/QA/DEV extract/merge, exclusive mode, sanitizer-safe markers

## 11. Acceptance criteria

- All aialm skills assemble identical WorkItemContext.

- Exclusive mode works; legacy [QA] titles do not pollute functional lists.

- AC, GENERATED QA, and Implementation Contract merges are idempotent and preserve outside human text.

- Proposal headers always include `aialm-<skill>:<id>`.

- Contract helpers expose stable test hooks for qa-impl without inventing business AC.
