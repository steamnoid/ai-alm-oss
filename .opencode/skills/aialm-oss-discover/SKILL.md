---
name: aialm-oss-discover
description: Scan open issues of an onboarded public OSS repo and persist qualified candidates with recommendation labels into its Jira tracking project. Use after onboarding a repo to find candidate work items.
---

# aialm-oss-discover

Scan the public issue space of an onboarded repository and identify candidate
work items with deterministic qualification data.

## Command

```
/aialm-oss-discover owner/repo
```

## Flow

1. Load the Project AI Profile (run `/aialm-oss-project-onboard` first if
   missing → BLOCKED).
2. List open issues (`GithubClient.listOpenIssues`; skips pull requests).
3. For each plausible candidate build a `CandidateIssue` (LLM judgment):
   issue_type, scope, ambiguity, code_localizability, testability,
   dependency_risk, expected_complexity, convention_fit,
   implementation_confidence, recommendation, rationale.
4. Persist via `persistCandidates` → Jira issues labeled `candidate` +
   recommendation, idempotent by the `aialm-external:` marker.
5. Summary comment/report using shared taxonomy:
   CREATED / SKIPPED counts per recommendation.

## Recommendation rules

- `READY` — implementable as-is within Profile conventions
- `NEEDS-CLARIFICATION` — missing info a maintainer would have to answer
- `BLOCKED` — needs credentials/private infra or exceeds complexity/risk threshold
- `UNSUITABLE` — out of scope per Profile restrictions

The agent MUST NOT convert NEEDS-CLARIFICATION or BLOCKED candidates into
executable tasks by inventing missing information.

## Tooling / MCP

Allow: GitHub read via adapter seam, ALM read/write limited to the repo's own
Jira project (candidate issues only). MUST NOT: comment on GitHub, create work
items outside candidate type, write code.
