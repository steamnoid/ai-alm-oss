# ai-alm-oss

Governed autonomous issue-to-PR workflow for public OSS repositories.

AI discovers and implements; humans approve at named gates; every step is traceable.

- Specification of record: Jira Cloud project [AIALMOSS](https://ai-alm-oss.atlassian.net/browse/AIALMOSS)
- Entry point (after implementation): `/aialm-oss-run owner/repo`
- Governance: everything between gates runs automatically; humans interact only AT gates (`APPROVE:<id>` comments) and BLOCKED resolutions

## Setup

```bash
cp .env.example .env   # fill in Jira credentials
npm install
npm run typecheck && npm test
```
