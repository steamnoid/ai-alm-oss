---
name: aialm-oss-po-analyze
description: Analyze ONE READY candidate issue for implementability and propose testable Product AC as plain-English Gherkin plus an execution plan sketch. Use after a candidate is READY to feed the QA/dev pipeline.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-po-analyze

Analyze one READY candidate issue into atomic, human-approvable proposal
comments. Never modifies the candidate description/metadata or the GitHub issue.

## Command

```
/aialm-oss-po-analyze owner/repo#issue
```

## Flow

1. Load the Project AI Profile + the candidate qualification.
2. Fetch the full issue body/comments via the adapter seam.
3. Gate: if the recommendation is not READY → post exactly one
   `[AI-generated] Blocked — owner/repo#issue` comment and stop.
4. LLM analyze into findings: `BLOCKING | NON-BLOCKING | CREATIVE`, each with
   a `why` and plain-English Gherkin. Max 2–3 CREATIVE per run.
5. Post one Proposal comment per atomic finding (1 issue = 1 Scenario) — never
   multi-scenario in a single comment.
6. Post a summary comment: BLOCKING/NON-BLOCKING/CREATIVE counts + proposal ids.

## Finding model

```
{
  issue,        // raised issue, plain English
  why,          // why it matters
  gherkin,      // Scenario: Given/When/Then/And
  kind          // BLOCKING | NON-BLOCKING | CREATIVE
}
proposalId = hash(norm(issue + gherkin))
executionSketch { touchedAreas[], riskNotes[], profileConventionFit }
```

## Comment template

```
[AI-generated] Proposal — <KEY> — aialm-oss-po-analyze:<id>
proposal:<id>  (+ creative:<id> if creative)
Raised issue — Why it matters
Proposed acceptance criteria
<pre>Scenario: ...</pre>
AI proposes; a human approves by commenting ✅ (or APPROVE:<id>).
```

## Rules

- **No technical safe defaults** — proposing framework/library/infra choices is
  owned by dev-analyst; raise them as findings, never as defaults.
- Split broad findings; never merge multiple scenarios into one comment.
- CREATIVE proposals still require a human ✅.

## Idempotency

- Skip identical `proposal:<id>` already present on the candidate record.
- A contradictory finding → a Conflict/Clarification Required comment, never a
  silent replace. Never delete existing proposals.

## Tooling / MCP

Allow: adapter reads (Profile, candidate, GitHub issue), comment list/create on
the candidate record.
MUST NOT: workitem update/create, GitHub writes, state/priority changes.
