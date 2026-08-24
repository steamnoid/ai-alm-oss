---
description: Open a traceable, human-approved public Pull Request against the target repo
---
Open the public PR for a delivery wave after verification + explicit approval.

Target: $ARGUMENTS (AIALMOSS-N)

Execute the aialm-oss-pr skill (`.opencode/skills/aialm-oss-pr/SKILL.md`):

1. Check the verify verdict is READY_FOR_PR (prGate with verdictReady); else
   BLOCKED.
2. Enforce the human approval gate (prApproved over comments with the wave key
   via prWaveKey) — no approval, no PR.
3. Prepare the branch + commits per Profile conventions (style, DCO/sign-off).
4. Build the PR body via buildPrBody (summary, Fixes owner/repo#N, tests /
   validation, known limitations, AI disclosure, execution trace link +
   read-only Viewer offer), honoring Profile.prTemplates; validate with
   validatePrBody.
5. Open the PR via the adapter seam; record PullRequestTrace (prUrl, commits,
   workItemIds). Idempotent per prWaveKey — re-run reports the existing PR
   (SKIPPED).
6. Post a summary comment on the parent with the PR link.

MUST NOT modify maintainer issues/comments, change repo settings, merge anything,
or bypass branch protection / contribution rules.
