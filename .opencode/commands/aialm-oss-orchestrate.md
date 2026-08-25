---
description: Run the background gate-advance poller for a repo project (daemon)
---
Advance the governed pipeline automatically for one repo project.

Target project: $ARGUMENTS (e.g. WELLBEINGT)

Run the daemon (long-running, 30s interval):

```bash
npx tsx scripts/orchestrate.mts --project=WELLBEINGT            # daemon (loop)
npx tsx scripts/orchestrate.mts --project=WELLBEINGT --once     # single pass
npx tsx scripts/orchestrate.mts --project=WELLBEINGT --dry      # report only, no writes
```

Behavior (see SKILL/advance.ts):

1. Polls Jira via `updated`-cursor (`state/<project>.json`) — reads only the delta.
2. Resolves each changed issue stage (description + comments + labels) and:
   - GENERATE — invokes the agent skill (mode A) for a generative step
     (po-analyze / po-prep-decompose / qa-analyze / dev-analyst), or
   - APPLY — runs the deterministic mutator (import / decompose / qa-apply / dev-apply),
   - once a human gate (`APPROVE:<id>`/✅) is satisfied — never invents anything.
3. Idempotent (ledger + mutator idempotency), fault-isolated (per-issue try/catch),
   lock-file, backoff, `--dry` never mutates or persists.

MUST NOT: invent AC/requirements, change target-repo state, comment on GitHub.
