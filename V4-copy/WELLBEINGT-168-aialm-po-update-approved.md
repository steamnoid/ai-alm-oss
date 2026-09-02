# WELLBEINGT-168: AIALM V4 — aialm-po-update-approved — Product AC applier (/aialm-po-update-approved)

**Traceability:** `/aialm-po-analyze` proposals → `/aialm-po-update-approved` → `## Acceptance Criteria`

**Skill:** `aialm-po-update-approved` | `/aialm-po-update-approved WELLBEINGT-N`

## 1. Goal

Batch-apply only human-approved `aialm-po-analyze` AC proposals into the target description section `## Acceptance Criteria`. Single description update per run. Idempotent.

## 2. Flow

```
`retrieve parent + comments + reactions
→ select proposals with skill marker aialm-po-analyze and hasHumanApprovalFor
→ extract Gherkin bodies
→ extractHumanAndAcSections; merge buildAcMarkdown
→ if shouldUpdateDescriptionAc → plane_workitem update description once
→ create summary comment [AI-generated] Update Approved AC — WELLBEINGT-N
`
```

## 3. Selection rules

- Include only well-formed proposals with `aialm-po-analyze:<id>` + `proposal:<id>`

- Approval per aialm-shared

- Skip: unapproved, malformed, trash-rejected if supported, already present AC (dedupe by normalized Gherkin/hash)

- Never invent AC

## 4. Mutation rules

- Preserve all non-AC human description verbatim

- Replace/rebuild only AC section content from approved set (deterministic order)

- At most one update; if identical → no update, summary Applied 0

## 5. Plane MCP

**Allow:** retrieve, comment list, reaction_list, workitem update (description only), comment create (summary).

**MUST NOT:** create proposals, create children, change metadata/state, modify non-description fields.

## 6. Deliverables

- `.opencode/skills/aialm-po-update-approved/SKILL.md`

- `.opencode/commands/aialm-po-update-approved.md`

- Service using plane helpers; unit tests for merge/dedupe/idempotency

## 7. Acceptance criteria

- Unapproved proposals never enter AC.

- Human non-AC text preserved.

- No duplicate AC on second run.

- Summary lists applied and skipped with proposal ids.

- Skill name in docs/commands is exactly `aialm-po-update-approved`.

## 8. Downstream

Enables `/aialm-po-prep-decompose` and later `/aialm-qa-analyze` (Product AC source).
