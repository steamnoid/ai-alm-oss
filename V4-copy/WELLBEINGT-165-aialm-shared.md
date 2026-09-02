# WELLBEINGT-165: AIALM V4 — aialm-shared — shared ALM contract and governance

**Traceability:** Parent WELLBEINGT-164 → foundation for all `aialm-*` skills

**Status:** Design — V4 (+ dev path)

**Skill / package name:** `aialm-shared` (not a slash-command; shared library contract)

## 1. Goal

Define the single shared governance contract used by every `aialm-po-*`, `aialm-qa-*`, and `aialm-dev-*` skill. Implementation must not invent per-skill variants of approval, identity, markers, or report status.

## 2. Naming contract

- Commands: `/aialm-po-analyze`, `/aialm-po-update-approved`, `/aialm-po-prep-decompose`, `/aialm-po-decompose`, `/aialm-qa-analyze`, `/aialm-qa-update-approved`, `/aialm-qa-impl`, `/aialm-dev-analyst`, `/aialm-dev-update-approved`, `/aialm-dev-impl`

- Skill folders: `.opencode/skills/aialm-<name>/SKILL.md`

- Command stubs: `.opencode/commands/aialm-<name>.md`

- Proposal skill marker in comments: `aialm-po-analyze:<id>`, `aialm-qa-analyze:<id>`, `aialm-dev-analyst:<id>`, etc.

- Never use bare names without `aialm-` for these skills

## 3. Input resolution

- Accept `WELLBEINGT-N`, UUID, or bare sequence

- Resolve to `project_id=2ac90835-bce4-4910-9b42-a9e509936ed1` unless overridden

- Invalid / missing work item → fail with clear error, no writes

## 4. Artifact identity

```
`proposalId = hash(normalize(stablePayload)).toString(16).slice(0,7).padStart(7,'0')
// same algorithm as proposalIdFor project-wide
`
```

- Every AI proposal comment includes `proposal:<id>`

- Header form: `[AI-generated] Proposal — WELLBEINGT-N — aialm-<skill>:<id>`

- Optional: `creative:<id>` when CREATIVE

## 5. Human approval

Approved iff one of:

- Human reaction `✅` or `👍` on the AI comment that contains that `proposal:<id>`

- Human comment containing `APPROVE:<id>` (or approve/LGTM + id)

Not approval: AI reactions, missing reaction, unrelated emoji, `🗑️` (reject / ignore for apply). Reactions loaded only via `plane-reactions_reaction_list` + `enrichCommentsWithReactions`.

## 6. Report status taxonomy

Every mutator/summary uses: `APPLIED`, `SKIPPED`, `BLOCKED`, `FAILED`, `NOT_ATTEMPTED`, and for create paths also `CREATED`; impl skills also use `IMPLEMENTED` / `IMPLEMENTED_WITH_FAILURES`.

## 7. Safety defaults for all aialm skills

- No hidden local DB beyond Plane comments/description and repo files where skill allows

- No webhook automation

- No state/priority/labels/assignee/archive unless skill explicitly allows (core V4 skills: none allow)

- No delete of human comments or unrelated children

- Missing business info → BLOCKED with missing decision text

## 8. Canonical AI_MARKERS (must match code)

- `## Acceptance Criteria`

- `## Implementation Contract`

- `[AI-generated] Proposal`

- `[AI-generated] Blocked`

- `[AI-generated] Update Approved AC`

- `[AI-generated] Update Approved QA`

- `[AI-generated] Update Approved Implementation Contract`

- `[AI-generated] Work Itemization` / Decomposition markers as used by prep/decompose

- `QA Scenario Proposal` (heading for aialm-qa-analyze selection)

- `Implementation Contract Proposal` (heading for aialm-dev-analyst selection)

- GENERATED QA: visible `GENERATED QA hash:` / `END GENERATED QA` (+ optional HTML comments; Plane may strip comments)

- GENERATED DEV: visible `GENERATED DEV hash:` / `END GENERATED DEV` (+ optional HTML comments)

## 9. Deliverables

- Documented constants in `src/aialm/shared/markers.ts` (and related)

- Shared helpers: `proposalIdFor`, `hasHumanApprovalFor`, `isAiComment`, enrich reactions

- Unit tests for approval, hash stability, marker parsing (QA + DEV)

## 10. Acceptance criteria

- All V4 skills (po/qa/dev) use identical approval and proposalId rules.

- All skill/command names use `aialm-` prefix.

- Reports use the shared status taxonomy.

- Reactions never read from local reactions.json file directly.

- No skill invents a private approval channel.

- Implementation Contract markers are first-class alongside Product AC and GENERATED QA.
