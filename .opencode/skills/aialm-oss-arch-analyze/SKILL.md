---
name: aialm-oss-arch-analyze
description: Propose Architecture Review findings (assigns ARCH role, falls back to DEV when the arch flag is off).
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-arch-analyze

Propose architecture-boundary findings from approved AC + codebase — never inventing a concern.

## Command

```
/aialm-oss-arch-analyze AIALMOSS-N
```

## Flow

1. Load target + approved AC; guard: no AC → Blocked per target.
2. Findings (title + body) per target.
3. Post one Proposal per finding (`aialm-oss-arch-analyze:<id>` + `proposal:<id>`), assign the **ARCH** role owner (or DEV + 'arch-aware' note when off).
4. Summary.

## Finding model

```
{ title, body }; proposalId = hash(norm('arch' + title + body))
```

## Idempotency / Tooling

Skip identical id; MUST NOT: self-approve, invent concerns, modify AC/state. Allow: retrieve, comment list/create, assign.
