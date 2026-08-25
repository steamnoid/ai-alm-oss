---
name: aialm-oss-project-onboard
description: Onboard a public OSS repo — provision its private Jira tracking project and build the Project AI Profile from public artifacts. Run this before any discovery or execution on a new repository.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.


# aialm-oss-project-onboard

Before selecting or executing any work item, reconstruct the target
repository's observable contribution workflow into an immutable
**Project AI Profile** and give the repo its own tracking home.

## Command

```
/aialm-oss-project-onboard owner/repo
```

## Flow

**Step 0 — Provision Jira project (`provisionRepoProject`)**

- key derived from repo name (uppercase alnum, ≤10 chars; suffix 2..9 on collision)
- name `[AI-ALM] owner/repo`, company-managed Kanban, PRIVATE
- idempotent: exact-name match is reused, never duplicated

**Step 0.5 — Ensure `Project Governance` ticket (`ensureGovernanceTicket`)**

- label `governance`, summary `Project Governance`, `## Roles` block
  (`po:`/`qa:`/`dev:` + optional `sec:`/`arch:` account ids) and `## Flags`
  (`sec`/`arch` default **on**); idempotent. The first command on a repo
  auto-creates it; edit to split responsibilities or toggle roles.

**Step 0.6 — Ensure CI (`aialm-oss-ci-ensure`)**

- `ProfileCollector.hasCi` (GitHub Actions present) + fallback validation
  commands from real `package.json` scripts (typecheck/test/build).
- If `hasCi=false`: build `.github/workflows/ci.yml` from real commands
  (unit + e2e) → **propose** → human `APPROVE` → write/commit/push →
  `verifyWorkflowRun` (green run required) → evidence (`run_id`); failure →
  per-job logs, iterate, after N retries → BLOCKED. Repo with CI → SKIPPED.

**Step 1 — Collect Profile (`ProfileCollector.collect`)**

- repo identity, default branch, languages (manifest probes + primary language)
- CONTRIBUTING.md, issue templates (.github/ISSUE_TEMPLATE), PR template
- CI commands: `run:` lines from .github/workflows (deduped, no echo)
- every missing artifact recorded as MISSING — never invented values

**Step 2 — Persist**

Write the Profile as ADF into the seeded **"Project AI Profile"** issue
(Task, label `profile`). The Profile is immutable during an execution wave;
refresh = re-run of this skill.

## Tooling / MCP

Allow: GitHub read via adapter seam, ALM writes limited to project creation +
Governance ticket + Profile issue. MUST NOT: create/modify other ALM items,
comment on GitHub, change target-repo state.
