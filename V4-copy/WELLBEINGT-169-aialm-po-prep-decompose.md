# WELLBEINGT-169: AIALM V4 — aialm-po-prep-decompose — Decomposition proposer (/aialm-po-prep-decompose)

**Traceability:** Approved Product AC → `/aialm-po-prep-decompose` → decomposition package proposal → `/aialm-po-decompose`

**Skill:** `aialm-po-prep-decompose` | `/aialm-po-prep-decompose WELLBEINGT-N`

## 1. Goal

Propose how to split ONE sufficiently specified work item into smaller independently implementable functional children. Does NOT create work items.

## 2. Preconditions

- Target has approved Product AC in description (`## Acceptance Criteria`) OR block with clear reason

- Assemble parent + comments (aialm-po-analyze history useful) + existing children

## 3. Output model — single package (V4 canonical)

One primary proposal comment (Work Itemization package) containing N child specs. Each child:

```
`{
 childKey: string, // stable id inside package, used for hash/idempotency
 title: string,
 goal: string,
 scope: string[],
 exclusions?: string[],
 acceptanceCriteria: string[], // Gherkin-ready plain English from parent AC subset
 sourceProductAcRefs: string[],
 dependencies: string[] // other childKeys or existing WELLBEINGT-ids
}
packageProposalId = hash(norm(package payload))
`
```

Header: `[AI-generated] Proposal — WELLBEINGT-N — aialm-po-prep-decompose:<packageId>` with `proposal:<packageId>`. Optional detailed child sections inside same comment for single human approval of the whole package (preferred for decompose executor).

## 4. Quality rules

- Preserve explicit requirements; do not invent business logic

- Cover all parent Product AC or report omission / BLOCKED

- Boundaries coherent; deps acyclic; order explicit

- If cannot split safely → Work itemization blocked comment, no fake split

## 5. Plane MCP

**Allow:** retrieve, comment list, comment create.

**MUST NOT:** create children, update parent description/state, assign/estimate.

## 6. Idempotency

Skip if identical packageProposalId already present. Never delete prior proposals. Do not duplicate packages with same normalized payload.

## 7. Deliverables

- `.opencode/skills/aialm-po-prep-decompose/SKILL.md`

- `.opencode/commands/aialm-po-prep-decompose.md`

- `src/service/work-itemize.ts` (or successor) + unit tests

## 8. Acceptance criteria

- Creates package proposal with aialm-po-prep-decompose marker, no children created.

- Each child has title/goal/scope/AC/deps/childKey.

- Full AC coverage or explicit BLOCKED/omission.

- Idempotent re-run.

- Plain English goals/scopes.

## 9. Downstream

Only human-approved package is executable by `/aialm-po-decompose`.
