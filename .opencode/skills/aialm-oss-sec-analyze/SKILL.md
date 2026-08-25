---
name: aialm-oss-sec-analyze
description: Propose Security Review findings for a target (assigns SEC role, falls back to DEV with a note when the sec flag is off).
---

# aialm-oss-sec-analyze

Propose security findings (auth/crypto/secrets/input handling) derived from approved Product AC + the codebase — never inventing a concern.

## Command

```
/aialm-oss-sec-analyze AIALMOSS-N
```

## Flow

1. Load target (description + comments) and its approved Product AC; guard: no AC → `[AI-generated] Blocked` per target, continue others.
2. Review findings (title + body) per target.
3. Post ONE Proposal comment per finding: marker `aialm-oss-sec-analyze:<id>` + `proposal:<id>`, then assign the **SEC** role owner (or DEV + 'security-aware' note when the sec flag is off).
4. Summary comment (CREATED/SKIPPED + ids).

## Finding model

```
{ title, body }
proposalId = hash(norm('sec' + title + body))
```

## Rules

- Behavioral/observable; never assert security is fine; never self-approve.
- Missing security decision → BLOCKED per target.

## Idempotency

Skip identical `proposal:<id>`; never delete existing proposals.

## Tooling / MCP

Allow: retrieve, comment list/create, assign (SEC or fallback DEV). MUST NOT: self-approve, invent concerns, modify AC/state.
