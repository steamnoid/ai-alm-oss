# WELLBEINGT-206: AIALM V4 — aialm-dev-impl — Feature implementer (/aialm-dev-impl)

**Traceability:** Product AC + GENERATED QA + approved Implementation Contract on the functional child → `/aialm-dev-impl` → application feature code

**Skill:** `aialm-dev-impl` | `/aialm-dev-impl WELLBEINGT-N` (parent or functional child id)

**Principle:** Implements approved intent only. Does not design new product behavior.

## 1. Goal

Materialize the approved Product AC and Implementation Contract into application code for the feature. Runs in parallel with `/aialm-qa-impl` under a frozen contract: this skill MUST NOT read Playwright specs produced in the same delivery wave, and qa-impl MUST NOT read this skill's feature diff as a substitute for the contract.

## 2. Input

- Resolve target: parent with exclusive functional children → each child independently; or a single functional child id.

- Require on each processed target:
 

 - approved Product AC section,

 - non-empty GENERATED QA (for intent alignment / non-goals awareness; do not re-derive QA),

 - non-empty Implementation Contract (GENERATED DEV) including testability hooks (e.g. data-testid) when UI is in scope.

 

- Missing contract → BLOCKED for that target (run `/aialm-dev-analyst` + update-approved first).

## 3. Codebase inspection (before write)

- App structure, existing patterns, auth, API routes, components, libs, tests (unit), scripts, typecheck/lint commands.

- Reuse existing infrastructure; do not invent parallel stacks.

## 4. Implementation rules

- Implement Product AC behaviors; wire every approved locator/seam from Implementation Contract exactly (same testid strings).

- Technical structure (files, helpers) may follow repo conventions; business behavior NEVER invented beyond AC + contract.

- Missing business decision not covered by AC/contract → BLOCKED that slice; do not weaken product behavior to make tests pass.

- MUST NOT: edit GENERATED QA intent; edit Product AC; edit Implementation Contract; create Plane work items; mark Done; read or rewrite `tests/e2e/**` from the parallel qa-impl wave as the source of truth (public pre-existing e2e helpers are OK).

## 5. Parallelism with aialm-qa-impl

- Shared inputs only: Product AC, GENERATED QA (behavioral), Implementation Contract, pre-existing main codebase.

- Forbidden cross-read: this skill's new feature files ↔ new Playwright specs from the same wave as mutual requirements.

- Battle test: e2e green only if the shared contract was precise enough.

## 6. Verification & report

```
`IMPLEMENTED | IMPLEMENTED_WITH_FAILURES | BLOCKED
# typecheck/unit as applicable; classify failures honestly
`
```

Optional summary comment on the functional child — must NOT mark Plane Done or change requirements.

## 7. Idempotency

Re-run updates the same feature areas when AC/contract changed; no duplicate parallel implementations; preserve unrelated code.

## 8. Plane MCP / tools

**Allow:** retrieve, comment list, reaction_list (provenance), repo read/write for app code, bash for typecheck/unit.

**MUST NOT:** modify Product AC, GENERATED QA, Implementation Contract intent, work item state/priority, create work items.

## 9. Deliverables

- `.opencode/skills/aialm-dev-impl/SKILL.md`

- `.opencode/commands/aialm-dev-impl.md`

- Feature code under the app tree; unit tests where repo convention expects them

## 10. Acceptance criteria

- Only targets with Product AC + Implementation Contract are implemented.

- Approved data-testid / seams from the contract are present in the UI/API surface.

- No silent product scope expansion beyond AC + contract.

- No cross-read of parallel qa-impl outputs as requirements.

- Honest status report; skill name exactly `aialm-dev-impl`.

## 11. Downstream

Together with `/aialm-qa-impl`, feeds end-to-end verification. Core delivery path is complete when both sides align on the frozen contract.
