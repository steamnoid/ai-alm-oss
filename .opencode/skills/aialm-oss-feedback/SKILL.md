---
name: aialm-oss-feedback
description: Classify maintainer PR review feedback into first-class ALM records, derive requirement deltas where legitimate, require renewed human approval for scope changes, and drive a governed correction cycle. Use after a PR is opened and receives review.
---

# aialm-oss-feedback

Treat external maintainer feedback as a first-class ALM artifact. Classify it,
derive a requirement delta where legitimate, require renewed human approval for
scope changes, and drive a governed correction cycle — without ever letting
feedback silently rewrite approved intent.

## Command

```
/aialm-oss-feedback AIALMOSS-N
```

## Flow

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

## V1.2 — fetch + classify + access-grant
`fetchPrReviewComments(gh, owner, repo, prNumber)` retrieves PR review comments via the adapter; `classifyReviewComment` → category/disposition/needsApproval. GitHub access-grant (invite + Viewer role) and revoke are governance actions: proposed (`accessGrantComment`) and executed by the agent ONLY after human approval — never automatic.
