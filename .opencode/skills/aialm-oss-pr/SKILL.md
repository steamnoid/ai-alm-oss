---
name: aialm-oss-pr
description: Create the public GitHub Pull Request only after verification READY_FOR_PR and an explicit human approval gate, with a fully traceable and honestly disclosed body. Use after aialm-oss-verify.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (email `aialmoss@icloud.com` — dopasuj po
> `emailAddress`/`accountId`), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.

# aialm-oss-pr

Create the public GitHub PR only after successful verification AND explicit
human approval for opening a public PR. The PR is the external face of the
governed execution — fully traceable and honestly disclosed.

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
