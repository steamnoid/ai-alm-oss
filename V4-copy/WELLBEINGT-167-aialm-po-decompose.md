# WELLBEINGT-167: AIALM V4 — aialm-po-decompose — Create children (/aialm-po-decompose)

**Traceability:** Approved `aialm-po-prep-decompose:<id>` → `/aialm-po-decompose` → real functional children

**Skill:** `aialm-po-decompose` | `/aialm-po-decompose WELLBEINGT-N`

## 1. Goal

Turn the latest human-approved decomposition package into real Plane child work items linked to parent. Only skill in V4 core that creates functional children.

## 2. Flow

```
`retrieve parent + comments + reactions + existing children
→ find approved aialm-po-prep-decompose package (hasHumanApprovalFor)
→ validate package (titles, AC, parent, deps resolvable, acyclic)
→ if invalid → stop Decomposition invalid / BLOCKED (no partial silent create)
→ sequential create children parent=parentId
→ resolve childKey deps to created identifiers as you go
→ summary comment: CREATED / SKIPPED / FAILED / NOT_ATTEMPTED
`
```

## 3. Child description contract

```
`> **AI-generated from:** WELLBEINGT-N
Created by /aialm-po-decompose
## Goal
## Scope
## Acceptance Criteria (Gherkin blocks preferred)
## Dependencies
## Traceability (package proposal id + childKey)
`
```

Use `buildChildDescription` updated to reference aialm pipeline names (not legacy analyst-ac paths).

## 4. Idempotency

- Detect existing child by stable key: preferred `childKey` / packageId marker in description, fallback normalized title match only if key missing

- Never silently update/delete existing children

- Preserve unrelated children (including [QA] children)

## 5. Partial failure

On failure of child C: report Created A,B; Failed C; Not attempted D. Resume later without duplicating A,B.

## 6. Plane MCP

**Allow:** retrieve, comment list, reaction_list, workitem create (children), comment create (summary).

**MUST NOT:** update parent description/state, auto-decompose without approval, bulk parallel create (sequential only for MVP).

## 7. Deliverables

- `.opencode/skills/aialm-po-decompose/SKILL.md`

- `.opencode/commands/aialm-po-decompose.md`

- `src/service/decomposer.ts` + tests (filterExistingPayloads, sequential create reporting)

## 8. Acceptance criteria

- Only explicitly approved aialm-po-prep-decompose package executes.

- Every created child has correct parent and approved content.

- Creation order respects dependencies.

- Idempotent resume without duplicates.

- Parent metadata/description unchanged.

- Summary uses shared status taxonomy.

## 9. Downstream

Functional children become targets for `/aialm-qa-analyze` exclusive mode.
