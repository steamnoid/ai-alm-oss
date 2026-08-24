---
description: Onboard an OSS repo — create its Jira tracking project and build the Project AI Profile
---
Onboard the target repository into the governed pipeline.

Target repository: $ARGUMENTS

Execute the aialm-oss-project-onboard skill (`.opencode/skills/aialm-oss-project-onboard/SKILL.md`):

1. Step zero: provisionRepoProject (private Jira project [AI-ALM] owner/repo;
   reuse if it already exists — never duplicate).
2. Collect Project AI Profile via ProfileCollector (languages, CONTRIBUTING,
   issue/PR templates, CI run commands). Missing artifacts recorded as MISSING,
   never invented.
3. Write the Profile into the seeded "Project AI Profile" issue description.
4. Report: project key, collected vs MISSING fields.
