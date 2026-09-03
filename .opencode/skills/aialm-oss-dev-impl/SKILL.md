---
name: aialm-oss-dev-impl
description: Materialize approved Product AC and Implementation Contract into application feature code in the target OSS repository, under a frozen contract shared with aialm-oss-qa-impl. Use after aialm-oss-dev-update-approved.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (dopasuj po `emailAddress`/`accountId` do
> aktualnie uwierzytelnionego użytkownika — `jira_jira_get_issue` assignee vs `myself`
> lub `aialmoss@icloud.com` jako fallback), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.
> Dla projektu WELLBEINGT (ai-alm-oss) prawidłowym assignee jest `ksw2zdz4h8@privaterelay.appleid.com` (host).

# aialm-oss-dev-impl

Materialize approved Product AC and Implementation Contract into application code
for the feature in the TARGET OSS repository. Runs in parallel with
`aialm-oss-qa-impl` under the frozen contract.

## State transitions (AGENTS.md — exclusive mutator)

Per AGENTS.md `AIALM STAGE/ROLE/AGENT` + `STAGE_NATIVE_STATUS`:

- **Start (before any analysis or writes):** `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT`
  (`AIALM STAGE=IN_PROGRESS_BY_AGENT`, `AIALM ROLE=DEV`, `AIALM AGENT=aialm-oss-dev-impl`)
  + native `AWAITS AGENT PICKUP` → `AGENT WORKING` (resolves to Transition id via `jira_jira_get_transitions`).
- **End (after proposals/summary, even if idempotent/semi-skipped/blocked):** `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL`
  (`AIALM STAGE=AWAITING_HUMAN_APPROVAL`, `AIALM ROLE=DEV`, `AIALM AGENT=none`)
  + native `AGENT WORKING` → `AWAITS HUMAN APPROVAL`.
- Do not leave the ticket in `IN_PROGRESS_BY_AGENT` even when all `proposal:<id>` already exist — run the full start→proposals→summary→end chain so the column reflects the mutation.

To mutate self-aware fields you need their project-correct custom-field ids (there are duplicate `AIALM ROLE/STAGE/AGENT` fields across projects). **Do NOT pick the first `jira_jira_search_fields` hit.** Instead: call `jira_jira_get_issue` with `fields=*all` + `use_display_names=true`, inspect the returned issue fields — the keys that actually contain `AIALM STAGE/ROLE/AGENT` values for THIS issue are the correct `customfield_XXXXX` for this project  (for WELLBEINGT: `10102`/`10103`/`10104` — **never `10100` for ROLE, that is a legacy duplicate field**). Use those IDs in `jira_jira_update_issue` with `{customfield_<STAGE>: {value: ...}, customfield_<ROLE>: {value: ...}, customfield_<AGENT>: {value: ...}}`. For native status: `jira_jira_get_transitions` → pick the one where `to.name` matches the target column (`AGENT WORKING` on start, `AWAITS HUMAN APPROVAL` on end) → `jira_jira_transition_issue`.

## Command

```
/aialm-oss-dev-impl AIALMOSS-N
```

## Input

- Resolve target: parent with exclusive functional children → each
  independently; or a single child id.
- Require per processed target: approved Product AC; non-empty GENERATED QA
  (intent alignment only); non-empty Implementation Contract with hooks when UI
  is in scope.
- Coding style/structure/scripts from Project AI Profile; missing contract →
  BLOCKED for that target.

## Codebase inspection (before write)

- App structure, patterns, auth, API routes, components, libs, unit tests,
  typecheck/lint commands — all per Profile.
- Reuse existing infrastructure; never invent parallel stacks.

## Implementation rules

- Implement AC behaviors; wire every approved locator/seam exactly (same hook
  strings).
- Technical structure follows Profile conventions; business behavior NEVER
  invented beyond AC + contract.
- Missing business decision → BLOCKED that slice; never weaken product behavior
  to make tests pass.
- MUST NOT: edit GENERATED QA intent / Product AC / Implementation Contract;
  create ALM work items; mark Done; read or rewrite same-wave `qa-impl` specs
  (`tests/***`) as source of truth (public pre-existing helpers are OK).

## Parallelism

- Shared inputs only; forbidden cross-read in both directions; e2e green only if
  the shared contract was precise enough (battle test).

## Verification & report

```
IMPLEMENTED | IMPLEMENTED_WITH_FAILURES | BLOCKED
```

Run Profile typecheck/lint/unit commands as applicable; classify honestly via
planImpl/classifyImpl.

## Idempotency

Re-run updates the same feature areas when AC/contract changed; no duplicate
parallel implementations; preserve unrelated code.

## Tooling

Allow: retrieve/comment/reaction reads, target-repo read/write for app code,
bash for typecheck/lint/unit.
MUST NOT: modify AC / QA / contract intent, work item state/priority, create
work items, open PRs.

## V1.2 — fork feature branch (isolated wave)

All Jira I/O stays on `description` + `comments` (never work-item state beyond the standard transitions). Repo writes are isolated per wave via `shared/git-ops`.

Use deterministic helpers from `src/aialm/oss/shared/git-ops.ts` (pure, unit-tested) — do NOT build raw `https://${GITHUB_TOKEN}@github.com/...` strings ad-hoc:

- `waveKeyFor(issueKey)` → `wellbeingt-5`
- `branchForWave(issueKey)` → `aialm/wellbeingt-5`
- `workDirFor(issueKey)` → `.work/wellbeingt-5`
- `httpsPushUrl(owner, repo, token)` → `https://x-access-token:<token>@github.com/owner/repo.git` (use `redactedPushUrl` for logs)
- `ensureFork(owner, repo, { client })` → idempotent fork (422 = already forked)
- `cloneArgs(pushUrl, workDir)` / `checkoutArgs(workDir, branch)` → `git` argv

Shell pattern inside the container (git + GITHUB_TOKEN are available via dispatcher `--env-file .env` and `-v $(pwd):/app`):

```bash
# fork (idempotent)
node -e "import('./src/aialm/oss/shared/git-ops.js').then(m=>m.ensureFork('upstreamOwner','repo').then(r=>console.log(r)))"
# clone + branch
git clone "$(node -e "import('./src/aialm/oss/shared/git-ops.js').then(m=>console.log(m.httpsPushUrl('forkOwner','repo',process.env.GITHUB_TOKEN)))")" "$(node -e "import('./src/aialm/oss/shared/git-ops.js').then(m=>console.log(m.workDirFor('WELLBEINGT-5')))")"
git -C .work/wellbeingt-5 checkout -B aialm/wellbeingt-5
# ... write feature code ...
git -C .work/wellbeingt-5 push origin aialm/wellbeingt-5
```

NEVER touch upstream `main` directly. Each wave works in its own `.work/<waveKey>/` clone so parallel waves never share a working copy. Model for all skills: `opencode/big-pickle`.
