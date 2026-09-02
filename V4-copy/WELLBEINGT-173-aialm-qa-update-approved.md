# WELLBEINGT-173: AIALM V4 — aialm-qa-update-approved — QA GENERATED applier (/aialm-qa-update-approved)

**Traceability:** Approved `aialm-qa-analyze` proposals → `/aialm-qa-update-approved` → GENERATED block merged inside each functional target's description → `/aialm-qa-impl`

**Skill:** `aialm-qa-update-approved` | `/aialm-qa-update-approved WELLBEINGT-N`

## 1. Goal

Batch human-approved QA proposals into the canonical behavioral GENERATED specification inside the analyzed target's OWN description. V4 creates no dedicated QA work items. Idempotent. Does not invent scenarios.

## 2. Target resolution

- V4 creates NO dedicated QA work items — the GENERATED block merges into the analyzed target's own description.

- If exclusive functional children: merge into EACH functional child independently; never cross-merge scenarios across unrelated children.

- If no functional children: merge into the target itself.

- Target with zero approved proposals → unchanged + reported SKIPPED.

## 3. Selection

- A comment qualifies as a QA proposal ONLY if ALL hold: h3 title `QA Scenario Proposal`, header stamp `aialm-qa-analyze:<id>`, footer `proposal:<id>` (same id).

- MUST ignore `Product AC Proposal` comments (`aialm-po-analyze:<id>`) and Work Itemization / Decomposition / summary comments — even though they use an identical envelope with `Scenario:` blocks and/or `proposal:<id>` strings.

- `hasHumanApprovalFor` after reaction enrich (✅|👍 on that proposal comment or human `APPROVE:<id>`/LGTM matching the exact id)

- Skip unapproved, malformed, trash-rejected, duplicates (normalized scenario hash)

- Preserve scenario text and source Product AC refs, kind, objective; missing metadata lines stay lenient (defaults CORE / empty objective)

## 4. GENERATED format (canonical for aialm-qa-impl)

```
`<!-- GENERATED QA hash: <hash> -->
# scenarios as <pre><code> Gherkin blocks, each may include metadata lines:
# source: product-ac:...
# kind: CORE|EDGE|CREATIVE
# objective: ...
Scenario: ...
 Given ...
 When ...
 Then ...
<!-- END GENERATED QA -->
`
```

- hash = deterministic over approved scenario set + sources

- First apply appends the block to the target description; later applies replace ONLY the block

- Manual notes and Product AC outside GENERATED preserved verbatim

- If hash/content identical → no description write; optional OK/sync summary

## 5. Mutation

- Mutate ONLY analyzed target descriptions via the GENERATED-block merge

- One summary comment on parent: `[AI-generated] Update Approved QA — WELLBEINGT-N` with APPLIED/SKIPPED/BLOCKED/malformed rows and updated target ids

- MUST NOT create work items, modify Product AC or functional child requirements, state/labels

## 6. Plane MCP

**Allow:** retrieve, list children, comment list/create, reaction_list, workitem update (target description only), comment create (summary).

**MUST NOT:** create work items, modify Product AC, write test code.

## 7. Deliverables

- `.opencode/skills/aialm-qa-update-approved/SKILL.md`

- `.opencode/commands/aialm-qa-update-approved.md`

- Helpers `collectQaProposals`/`buildTargetMerge`; unit tests for hash, exclusive targets, PO-proposal exclusion, preserve manual notes/Product AC

## 8. Acceptance criteria

- Only approved comments titled `QA Scenario Proposal` AND stamped `aialm-qa-analyze` enter GENERATED; Product AC proposals never enter regardless of embedded Scenario content.

- Scenarios merge into the analyzed target's own description; no cross-target merging; no work items created.

- GENERATED is stable, behavioral, consumable by aialm-qa-impl.

- Idempotent second run applies 0 when unchanged.

- Summary reports APPLIED/SKIPPED/BLOCKED/malformed.

- Skill name exactly `aialm-qa-update-approved`.

## 9. Downstream

GENERATED is sole source of truth for `/aialm-qa-impl`.
