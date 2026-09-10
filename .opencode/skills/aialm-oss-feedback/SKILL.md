---
name: aialm-oss-feedback
description: Classify maintainer PR review feedback into first-class ALM records, derive requirement deltas where legitimate, require renewed human approval for scope changes, and drive a governed correction cycle. Use after a PR is opened and receives review.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-feedback

Treat external maintainer feedback as a first-class ALM artifact. Classify it,
derive a requirement delta where legitimate, require renewed human approval for
scope changes, and drive a governed correction cycle — without ever letting
feedback silently rewrite approved intent.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=PO`, `AIALM AGENT=aialm-oss-feedback`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=PO`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-feedback AIALMOSS-N
```

## Flow — PR poller is step 0

0. **PR merged/closed poll:** Derive `head` from the ticket's `prUrl` comment (`paligakrzychu:aialm/<waveKey>` → `owner:branch` + `baseOwner/baseRepo` from `prUrl`). Call `GithubClient.getPull(baseOwner, baseRepo, head)` (read-only, public, no extra scope). 
   - `merged==true` → post `[AI-generated] Feedback — PR #N merged at <merged_at> → DONE`, then `IN_PROGRESS_BY_AGENT → DONE` (`AIALM STAGE=DONE`, `ROLE` null, `AGENT=none` + native `Done`). Stop — do not classify review comments as deltas (the delivery is closed). When `verify` was `NOT READY_FOR_PR`, do NOT auto-close — instead stay `AWAITING_HUMAN_APPROVAL` with `BLOCKED: verify not READY_FOR_PR`.
   - `state==closed && !merged` → post `PR #N closed without merge at <closed_at> — feedback cycle`, `IN_PROGRESS_BY_AGENT → AWAITING_HUMAN_APPROVAL` (`ROLE=PO`, `AGENT=none`), then continue to classify the close reason.
   - `state==open` → continue to review classification.

1. Fetch PR review comments via the adapter (PullRequestTrace → prUrl).
2. Classify each comment:
   `CLARIFICATION | BUG | MISSING_TEST | STYLE | ARCHITECTURE | SCOPE_CHANGE | BLOCKER`.
3. Disposition per category:
   - CLARIFICATION / STYLE → correction plan, no re-approval (non-intent)
   - BUG / MISSING_TEST → correction mapped to existing AC / scenarios
   - ARCHITECTURE → contract-level change proposal (dev-analyst rerun)
   - SCOPE_CHANGE / BLOCKER → requirement delta proposal → HUMAN APPROVAL required
4. Create Feedback Record comment(s) with classification + planned action.
5. After approvals, route corrections through the appropriate impl/verify skills.
6. Append evidence; update the trace (new commits).

## Access requests & seat hygiene

- Detect maintainer visibility requests (PR/issue comments).
- Propose an `AccessGrant` (account/email) → HUMAN APPROVAL gate (✅/`APPROVE:`).
- After approval: invite the account if needed, assign project role Viewer via
  API, append an `EvidenceEntry`.
- When the PR is merged/closed: propose revoking Viewer grants to free license
  seats (Free plan ≈ 10 seats).

## Rules

- A maintainer comment MUST NOT silently rewrite the approved requirement;
  deltas become explicit proposals with ids.
- `SCOPE_CHANGE` requires renewed human approval before any implementation.
- No autonomous replies to maintainers on GitHub (external communication stays
  out of V1 scope — human posts).
- Corrections reuse the standard pipeline (po/qa/dev) rather than ad-hoc edits.

## Idempotency

Feedback records are keyed by normalized comment ref (`pr#N/comment-id`); a
re-run classifies only new comments; never deletes prior records.

## Tooling

Allow: GitHub read of review comments via adapter seam, ALM retrieve/comment
list/create, reaction list.
MUST NOT: post to GitHub, modify code/tests directly, change ALM item states.

## Downstream

Closed loop: corrections → verify → updated commits on the existing PR (via the
oss-pr idempotent path).

## V1.2 — fetch + classify + access-grant + PR poller
`GithubClient.getPull(baseOwner, baseRepo, head)` and `getPullByNumber` power the PR `merged`/`closed` poll (no `gh` CLI, uses `GITHUB_TOKEN` from `.env` via `dispatcher --env-file`; public `GET` works unauthenticated at 60 req/h). `fetchPrReviewComments(gh, owner, repo, prNumber)` retrieves PR review comments via the adapter; `classifyReviewComment` → category/disposition/needsApproval. GitHub access-grant (invite + Viewer role) and revoke are governance actions: proposed (`accessGrantComment`) and executed by the agent ONLY after human approval — never automatic. **PR merged → `DONE` is automatic only when `verify` was `READY_FOR_PR`; otherwise `AWAITING_HUMAN_APPROVAL` with `BLOCKED` (no silent close on NOT READY).**
