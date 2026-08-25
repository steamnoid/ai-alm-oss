---
name: aialm-oss-orchestrate
description: Run the governed background gate-advance poller for a repo project (daemon); advances stages on human approvals.
---

# aialm-oss-orchestrate

Long-running daemon that polls Jira for a repo project and advances the governed pipeline one stage at a time, idempotently and without invention. Humans only act at gates.

## Command

```
/aialm-oss-orchestrate <PROJECT> [--dry|--once|--interval=N]
npx tsx scripts/orchestrate.mts --project=WELLBEINGT [--dry|--once]
```

## Flow

1. State: `state/<project>.json` { cursor, consumed } — the `updated`-cursor plus an idempotency ledger.
2. Poll: JQL `project=X AND updated >= cursor ORDER BY updated ASC` → only the delta (O(Δ), not O(N)).
3. For each changed issue, resolve the stage (`resolveNext`: description + comments + labels):
   - candidate, no AC → GENERATE `po-analyze` (assign PO)
   - proposals, no approval → WAIT (gate)
   - approved → APPLY `import` (in-place, unassign)
   - has AC, no package → GENERATE `po-prep-decompose`; approved → APPLY `decompose`
   - children → `qa-analyze`/`dev-analyst` (GENERATE, assign QA/DEV) → applies → `sec/arch-analyze` (GENERATE, assign SEC/ARCH or fallback DEV) → applies → `qa-impl`/`dev-impl` → `verify` (READY_FOR_PR) → `pr`
   - role off + concern → fall back to DEV owner with an explicit note (never machine-approved)
4. GENERATE launch the skill as an agent subprocess (mode A: `opencode run <skill> <key>`); APPLY runs the deterministic mutator directly.
5. Update the cursor; ledger prevents re-apply; per-issue try/catch keeps the loop alive.

## Guards

- No self-approval: only comments marked `[AI-generated]` are ignored by the approval reader; the poller never posts an approval-shaped comment.
- `--dry` never mutates or persists state.
- Lock-file + backoff; `--once` for a single pass.

## Tooling / MCP

Allow: Jira read/search + assign/unassign + comment list; deterministic mutators (import/apply/decompose/review); spawn the agent for the next skill. MUST NOT: invent requirements, touch GitHub state, comment on GitHub.
