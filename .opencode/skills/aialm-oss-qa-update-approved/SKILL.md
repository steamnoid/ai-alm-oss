---
name: aialm-oss-qa-update-approved
description: Batch human-approved QA proposals into the canonical behavioral GENERATED specification inside each analyzed target's OWN description. Use after QA proposals are approved and before aialm-oss-qa-impl.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (email `aialmoss@icloud.com` — dopasuj po
> `emailAddress`/`accountId`), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.

# aialm-oss-qa-update-approved

Merge approved QA scenarios into the canonical `GENERATED QA` block inside each
analyzed target's own description. No dedicated QA work items; idempotent; never
invents scenarios.

## Command

```
/aialm-oss-qa-update-approved AIALMOSS-N
```

## Target resolution

- Exclusive functional children: merge into EACH child independently; never
  cross-merge scenarios across unrelated children.
- No functional children: merge into the target itself.
- Zero approved proposals for a target → unchanged (SKIPPED).

## Selection

Qualifies ONLY if ALL hold:
- heading `QA Scenario Proposal`
- header stamp `aialm-oss-qa-analyze:<id>`
- footer `proposal:<id>` (same id)

MUST ignore Product AC proposals, Candidate Qualification, Import Report and
Work Itemization/summary comments — even with an identical envelope. Approval via
`hasHumanApprovalFor` (✅/👍 or human `APPROVE:`/LGTM). Skip unapproved,
malformed, trash-rejected or duplicate proposals (normalized scenario hash);
missing metadata lines stay lenient (defaults CORE / empty objective).

## GENERATED format (canonical for aialm-oss-qa-impl)

```
<!-- GENERATED QA hash: <hash> -->
# source: ...
# kind: CORE | EDGE | CREATIVE
# objective: ...
Scenario: ... Given/When/Then ...
<!-- END GENERATED QA -->
```

- `hash` = deterministic over the approved scenario set + sources.
- First apply appends the block; later applies replace ONLY the block; manual
  notes and AC outside it are preserved verbatim.
- Identical hash → no write.

## Mutation & tooling

Allow: retrieve, list children, comment list/create, reaction list, workitem
update (target description only), comment create (one summary on the parent).
MUST NOT: create work items, modify Product AC, change state/labels, write test
code.

## Downstream

`GENERATED` is the sole source of truth for `/aialm-oss-qa-impl`.
