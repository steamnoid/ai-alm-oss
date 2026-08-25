---
name: aialm-oss-po-decompose
description: Turn the latest human-approved decomposition package into real ALM child work items linked to the imported parent. The only skill that creates functional children. Use after a decomposition package is approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-po-decompose

Create real functional child work items from the latest human-approved
`aialm-oss-po-prep-decompose` package. Sequential create, idempotent.

## Command

```
/aialm-oss-po-decompose AIALMOSS-N
```

## Flow

1. Retrieve the parent + comments + reactions + existing children.
2. Find the latest approved `aialm-oss-po-prep-decompose` package
   (`hasHumanApprovalFor`).
3. Validate the package (titles, AC, deps resolvable, acyclic, Profile-fit).
   If invalid → stop: Decomposition invalid / BLOCKED (no partial silent
   create).
4. Create children sequentially in dependency order, `parent = parentKey`.
   Description:
   ```
   > **AI-generated from:** AIALMOSS-N (externalSource owner/repo#N)
   Created by /aialm-oss-po-decompose
   ## Goal / ## Scope / ## Acceptance Criteria / ## Dependencies / ## Traceability
   ```
5. Resolve childKey dependencies to created identifiers as you go.
6. Post a summary comment: CREATED / SKIPPED / FAILED / NOT_ATTEMPTED.

## Idempotency

- Detect an existing child by stable key (`childKey:` / `packageProposal:`
  marker in description); fallback normalized title only if the key is missing.
- Never silently update/delete existing children; preserve unrelated children.

## Partial failure

Report Created A,B; Failed C; Not attempted D — resumable without duplicating
A,B (dependents of a failed child are NOT_ATTEMPTED).

## Tooling / MCP

Allow: retrieve, comment list/create, reaction list, workitem create (children),
comment create (summary).
MUST NOT: update parent description/state, auto-decompose without approval,
bulk parallel create.

## Downstream

Functional children become targets for `/aialm-oss-qa-analyze` exclusive mode.
