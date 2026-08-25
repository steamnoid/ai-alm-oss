---
name: aialm-oss-verify
description: Run the target repository's validation commands against the delivery wave and produce auditable, machine-checkable evidence that the change is PR-ready. Use after aialm-oss-qa-impl / aialm-oss-dev-impl, before aialm-oss-pr.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-verify

Run the target repository's relevant validation commands (from Project AI
Profile) against the delivery wave and produce auditable, machine-checkable
evidence that the change is PR-ready. Never claims successful validation without
executable evidence.

## Command

```
/aialm-oss-verify AIALMOSS-N
```

## Flow

1. Resolve work item(s) + wave outputs (feature diff + test specs).
2. Load Profile.ciCommands (typecheck, lint, unit, integration, e2e).
3. Execute commands in order; capture exit codes + logs as `EvidenceEntry[]`
   (via makeEvidence) — append-only, never hidden or silently retried.
4. Run the GENERATED QA suite; map results to scenarios (pass/fail per
   traceability id).
5. Classify per child: PASS | PARTIAL | FAILED | BLOCKED.
6. Persist the evidence summary on the parent (comment) — append-only.
7. PR-readiness verdict: only when ALL CORE scenarios are green →
   READY_FOR_PR.

## Evidence contract

```
EvidenceEntry { stage:"verify", command, artifactRef(logs), result: pass|fail|error, timestamp }
ScenarioResult { scenarioId, testTitle, kind, outcome }
```

No "success" without captured command output.

## Failure handling

- FAILED → report which AC/scenario failed and point to logs; no auto-fix here
  (correction belongs to a governed re-run of the impl skills).
- BLOCKED → missing Profile commands or environment; explicit reason.

## Tooling

Allow: retrieve/comment read-writes (evidence comments), bash execution of
Profile.ciCommands, reading repo state.
MUST NOT: modify code/tests, change ALM item states, open/close PRs, or comment
on GitHub.

## Downstream

A READY_FOR_PR verdict enables `/aialm-oss-pr`.

## V1.2 — executor + CI on PR
`runValidation(Profile.ciCommands)` executes commands via bash and returns EvidenceEntry[] (exit codes + output; result pass|fail|error) — no success claimed without real evidence. PR Actions (`pull_request`) is complementary evidence; READY_FOR_PR only when all CORE green.
