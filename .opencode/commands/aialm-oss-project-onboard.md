---
description: Onboard an OSS repo — create its Jira tracking project and build the Project AI Profile
---
Onboard the target repository into the governed pipeline.

Target repository: $ARGUMENTS

Execute the aialm-oss-project-onboard skill (`.opencode/skills/aialm-oss-project-onboard/SKILL.md`):

1. Step zero: provisionRepoProject (private Jira project [AI-ALM] owner/repo;
   reuse if it already exists — never duplicate).
2. Ensure the per-project `Project Governance` ticket (label `governance`) with
   the role map `po:/qa:/dev:` (defaults = project lead) — created once,
   idempotent. First command of a repo auto-creates it.
3. Collect Project AI Profile via ProfileCollector (languages, CONTRIBUTING,
   issue/PR templates, CI run commands). Missing artifacts recorded as MISSING,
   never invented.
4. Write the Profile into the seeded "Project AI Profile" issue description.
5. Report: project key, governance key, collected vs MISSING fields.
