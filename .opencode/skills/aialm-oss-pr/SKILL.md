---
name: aialm-oss-pr
description: Create the public GitHub Pull Request only after verification READY_FOR_PR and an explicit human approval gate, with a fully traceable and honestly disclosed body. Use after aialm-oss-verify.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-pr

Create the public GitHub PR only after successful verification AND explicit
human approval for opening a public PR. The PR is the external face of the
governed execution — fully traceable and honestly disclosed.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=DEV`, `AIALM AGENT=aialm-oss-pr`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=DEV`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-pr AIALMOSS-N
```

## Flow

1. Check the verify verdict == READY_FOR_PR; else BLOCKED.
2. HUMAN APPROVAL GATE: open PR? (✅ / `APPROVE:<id>`) — no approval, no PR.
3. Prepare the branch + commits per Profile conventions (commit message style,
   DCO / sign-off if required).
4. PR body MUST contain:
   - concise implementation summary
   - relationship to original issue (`Fixes owner/repo#N`)
   - tests / validation performed (evidence refs)
   - known limitations
   - AI-generated contribution disclosure (safe default: disclose)
   - link to the public AI-ALM execution trace
5. Open the PR via the adapter seam; record `PullRequestTrace { prUrl,
   commits[], workItemIds[] }`.
6. Post a summary comment on the parent with the PR link.

## PR content contract

- Follows Profile.prTemplates exactly; respects labelConventions.
- Trace link included automatically with a read-only Viewer offer:
  "Want full visibility? Reply here and we will invite your account as a
  read-only Viewer of the execution-trace project."
- Granting any external account access always goes through the human approval
  gate and lands as an `AccessGrant` record.

## Idempotency

One open PR per work-item wave keyed by trace; a re-run reports the existing PR
(SKIPPED) instead of creating a duplicate.

## Tooling

Allow: git operations on the delivery branch, GitHub PR create via the adapter
seam, ALM comment create.
MUST NOT: modify maintainer issues/comments, change repo settings, merge
anything, or bypass branch protection / contribution rules.

## Downstream

Maintainer feedback enters `/aialm-oss-feedback`.

## V1.2 — fork → upstream PR
PR head = <forkOwner>:<branchForWave(...)>, base = upstream default; one PR per wave (prWaveKey); idempotent. Commit style/DCO from Profile. Access-grant Viewer is a human-approval-gated proposal (agent invites/grants only after APPROVE), never automatic.
