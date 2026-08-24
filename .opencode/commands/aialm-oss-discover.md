---
description: Discover qualified candidate issues in an onboarded OSS repo and persist them to Jira
---
Scan open issues of the target repository and persist qualified candidates.

Target repository: $ARGUMENTS

Execute the aialm-oss-discover skill (`.opencode/skills/aialm-oss-discover/SKILL.md`):

1. Require the Project AI Profile (BLOCKED with instruction to run
   /aialm-oss-project-onboard if missing).
2. List open issues via GithubClient.listOpenIssues.
3. Qualify each plausible candidate as CandidateIssue (LLM judgment, all fields,
   never invented) and assign recommendation READY | NEEDS-CLARIFICATION |
   UNSUITABLE | BLOCKED.
4. Persist via persistCandidates into the repo's Jira project
   (labels: candidate + recommendation; idempotent by aialm-external marker).
5. Report CREATED / SKIPPED rows with refs, grouped by recommendation.
