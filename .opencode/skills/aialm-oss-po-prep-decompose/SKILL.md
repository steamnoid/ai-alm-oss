---
name: aialm-oss-po-prep-decompose
description: Propose how to split one sufficiently specified AI-ALM Work Item into independently implementable functional children (a single decomposition package). Does not create work items. Use after a work item has approved Product AC.
---

# aialm-oss-po-prep-decompose

Propose a single decomposition package for one AI-ALM Work Item. Never creates
children — the human approves the package first.

## Command

```
/aialm-oss-po-prep-decompose AIALMOSS-N
```

## Preconditions

- Target has approved Product AC in its description (`## Acceptance Criteria`)
  OR block with a clear reason.
- Project AI Profile present — conventions inform boundary drawing.
- Assemble parent description + comments + any existing children.

## Output model — single package

```
{
  childKey: string,               // stable id inside package
  title: string,
  goal: string,                   // plain English
  scope: string[],
  exclusions?: string[],
  acceptanceCriteria: string[],   // Gherkin-ready subset of parent AC
  sourceProductAcRefs: string[],
  dependencies: string[],         // other childKeys or external refs
  profileNotes?: string[]         // convention constraints from Profile
}
packageProposalId = hash(norm(package payload))
```

One primary proposal comment
`[AI-generated] Proposal — AIALMOSS-N — aialm-oss-po-prep-decompose:<packageId>`
containing all child specs for a single human approval.

## Quality rules

- Preserve explicit requirements; never invent business logic.
- Cover ALL parent Product AC, or report omission / BLOCKED.
- Coherent boundaries; acyclic dependencies; explicit ordering; respect Profile
  structure/conventions when drawing boundaries.
- If it cannot be split safely → post a Work Itemization Blocked comment; no fake
  split.

## Tooling / MCP

Allow: retrieve, comment list/create.
MUST NOT: create children, update parent description/state, assign/estimate.

## Idempotency

- Skip if an identical `packageProposalId` is already present.
- Never delete prior proposals; no duplicate packages with the same normalized
  payload.

## Downstream

Only the human-approved package is executable by `/aialm-oss-po-decompose`.
