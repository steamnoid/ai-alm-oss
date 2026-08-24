---
name: aialm-oss-project-onboard
description: Onboard a public OSS repo — provision its private Jira tracking project and build the Project AI Profile from public artifacts. Run this before any discovery or execution on a new repository.
---

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
Profile issue. MUST NOT: create/modify other ALM items, comment on GitHub,
change target-repo state.
