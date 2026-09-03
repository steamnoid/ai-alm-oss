---
name: aialm-oss-project-onboard
description: Onboard a public OSS repo — provision its private Jira tracking project and build the Project AI Profile from public artifacts. Run this before any discovery or execution on a new repository.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-project-onboard

Before selecting or executing any work item, reconstruct the target
repository's observable contribution workflow into an immutable
**Project AI Profile** and give the repo its own tracking home.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=AI`, `AIALM AGENT=aialm-oss-project-onboard`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=AI`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

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
