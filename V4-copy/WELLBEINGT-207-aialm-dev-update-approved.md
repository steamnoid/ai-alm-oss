# WELLBEINGT-207: AIALM V4 — aialm-dev-update-approved — Implementation Contract applier (/aialm-dev-update-approved)

**Traceability:** Approved `aialm-dev-analyst` proposals → `/aialm-dev-update-approved` → `## Implementation Contract` (GENERATED DEV) on each functional target → parallel `/aialm-qa-impl` ∥ `/aialm-dev-impl`

**Skill:** `aialm-dev-update-approved` | `/aialm-dev-update-approved WELLBEINGT-N`

## 1. Goal

Batch human-approved implementation / testability proposals into the canonical `## Implementation Contract` section inside each analyzed functional child's own description. Idempotent. Does not invent contract details. Does not create work items.

## 2. Target resolution

- Exclusive functional children: merge into EACH functional child independently; never cross-merge contracts across unrelated children.

- No functional children: merge into the target itself when applicable.

- Zero approved proposals for a target → unchanged + SKIPPED.

- MUST NOT create dedicated contract or QA work items.

## 3. Selection

- A comment qualifies ONLY if ALL hold: h3 title `Implementation Contract Proposal`, header stamp `aialm-dev-analyst:<id>`, footer `proposal:<id>` (same id).

- Ignore Product AC proposals, QA Scenario proposals, Work Itemization / Decomposition / summary comments.

- Approval: ✅|👍 on that comment or human `APPROVE:<id>` (same rules as aialm-shared).

- Skip unapproved, malformed, trash-rejected, duplicates (normalized body hash).

## 4. Implementation Contract format (canonical for qa-impl + dev-impl)

```
`## Implementation Contract
<p><code>GENERATED DEV hash: <hash></code></p>
<!-- GENERATED DEV hash: <hash> --> <!-- optional dual marker; Plane may strip HTML comments -->
# entries from approved proposals (kind, source, consumers, body)
…
<p><code>END GENERATED DEV</code></p>
<!-- END GENERATED DEV -->
`
```

- hash = deterministic over approved contract entry set

- First apply appends the section; later applies replace ONLY the GENERATED DEV region

- Preserve Product AC, GENERATED QA, and all manual notes outside the region verbatim

- Identical hash → no description write

- Sanitizer-proof: always emit visible-text hash markers (same lesson as QA GENERATED)

## 5. Mutation

- Mutate ONLY analyzed target descriptions via Implementation Contract merge

- One summary on parent: `[AI-generated] Update Approved Implementation Contract — WELLBEINGT-N` with APPLIED/SKIPPED/BLOCKED/malformed and target ids

- MUST NOT: create work items; modify Product AC or GENERATED QA intent; change state/labels; write app or test code

## 6. Plane MCP

**Allow:** retrieve, list children, comment list/create, reaction_list, workitem update (description only).

**MUST NOT:** create work items, modify Product AC / GENERATED QA, write tests or feature code.

## 7. Deliverables

- `.opencode/skills/aialm-dev-update-approved/SKILL.md`

- `.opencode/commands/aialm-dev-update-approved.md`

- Helpers collect/merge/hash; unit tests for isolation, PO/QA exclusion, preserve outside content, sanitizer-safe markers

## 8. Acceptance criteria

- Only approved `Implementation Contract Proposal` + `aialm-dev-analyst` enter the contract.

- Contract merges into the functional target's own description; no work items created.

- Product AC and GENERATED QA remain untouched.

- Idempotent second run applies 0 when unchanged.

- Summary reports APPLIED/SKIPPED/BLOCKED/malformed.

- Skill name exactly `aialm-dev-update-approved`.

## 9. Downstream

Implementation Contract is shared frozen input for `/aialm-qa-impl` and `/aialm-dev-impl` running in parallel without cross-reading each other's code outputs.
