# WELLBEINGT-166: AIALM V4 — aialm-po-analyze — Product AC proposer (/aialm-po-analyze)

**Traceability:** Idea ticket → `/aialm-po-analyze` → proposals → `/aialm-po-update-approved`

**Status:** Design — V4

**Skill name:** `aialm-po-analyze` | Command: `/aialm-po-analyze WELLBEINGT-N`

**Principle:** AI proposes → human approves via click → AI executes (later skill)

## 1. Goal & Scope

Analyze ONE Plane work item for product ambiguities and propose testable Product AC as plain-English Gherkin. MUST NOT modify description/metadata. MUST NOT propose technical safe defaults (owned by analyst-tech).

## 2. MVP flow

```
`/aialm-po-analyze WELLBEINGT-N
→ assemble WorkItemContext (retrieve + comments + children)
→ gate: isBlockedByMissing?
→ LLM analyze BLOCKING | NON-BLOCKING | CREATIVE
→ create one Proposal comment per atomic finding (1 issue = 1 Scenario)
→ user summary`
```

## 3. Input

Identifier forms per aialm-shared. Context: title, description, state/priority/labels/type/parent/relations, comments, children for gating only.

## 4. Finding model

```
`{
 issue: string,
 why: string,
 gherkin: string, // Scenario: Given/When/Then/And
 kind: "BLOCKING" | "NON-BLOCKING" | "CREATIVE",
 proposalId: string // hash(norm(issue + gherkin))
}`
```

- Max 2–3 CREATIVE per run; badge CREATIVE PROPOSAL; still needs human ✅

- Split broad findings; never multi-scenario one comment

- Plain English first sentence; jargon only in parentheses/<details>

## 5. Comment template

```
`[AI-generated] Proposal — WELLBEINGT-N — aialm-po-analyze:<id>
proposal:<id> (+ creative:<id> if creative)
Raised issue — Why it matters
Proposed acceptance criteria
<pre>Scenario: ...</pre>
AI proposes, human approves via click.`
```

Use `buildProposalComment(..., skill="aialm-po-analyze")`.

## 6. Gating

If `MISSING — BLOCKING` in comments not covered by child → one `[AI-generated] Blocked — WELLBEINGT-N` and stop. Rerun after human comment/child.

## 7. Plane MCP

| 
| AllowPurpose |

| workitem retrieve / retrieve_by_identifierparent |

| workitem list (children filter client-side)gating |

| comment list / createcontext + proposals + blocked |

 |

**MUST NOT:** workitem update, manage_*, archive, create children, change state/priority/labels/assignee.

## 8. Idempotency

Before create, list existing `proposal:<id>` / normalized bodies. Same hash → skip. Contradictory → Conflict / Clarification Required comment, never silent replace. Never delete.

## 9. Ownership / MUST NOT

No analyst-tech, no aialm-po-prep-decompose, no aialm-po-decompose, no aialm-qa-*, no description AC merge.

## 10. Deliverables

- `.opencode/skills/aialm-po-analyze/SKILL.md`

- `.opencode/commands/aialm-po-analyze.md`

- Optional service helpers + `tests/unit/analyzer.test.ts`

## 11. Acceptance criteria

- Manual trigger creates proposal comments only; description unchanged.

- Each comment is atomic 1:1 issue↔Gherkin with `aialm-po-analyze:<id>`.

- No technical safe defaults proposed.

- Idempotent re-run skips duplicates.

- Blocked path creates exactly one Blocked comment and stops.

- User summary reports BLOCKING/NON-BLOCKING/CREATIVE counts and proposal ids.

## 12. Downstream

Approved proposals consumed only by `/aialm-po-update-approved`.
