# ai-alm-oss

Governed autonomous issue-to-PR workflow for public OSS repositories.

AI discovers and implements; humans approve at named gates; every step is traceable.

- Specification of record: Jira Cloud project [AIALMOSS](https://ai-alm-oss.atlassian.net/browse/AIALMOSS)
- Entry point (after implementation): `/aialm-oss-run owner/repo`
- Governance: everything between gates runs automatically; humans interact only AT gates (`APPROVE:<id>` comments, or a ✅ in a comment) and BLOCKED resolutions
- Single-threaded traceability: an approved candidate is upgraded **in place** into the governed AI-ALM Work Item (same ticket preserves the full chain issue → work item → AC → QA → contract → tests → PR)
- Per-repo role map: a `Project Governance` ticket (label `governance`) in the repo's project holds `po:`/`qa:`/`dev:` (+ optional `sec:`/`arch:`) account ids and `## Flags` (`sec`/`arch` default **on**); split there
- Optional review gates: `aialm-oss-sec-analyze`→`sec-update-approved` and `arch-analyze`→`arch-update-approved` mirror `qa-analyze`; role off → fall back to DEV with an explicit note, never machine-approved
- CI-ensure: onboarding detects missing GitHub Actions (`hasCi`) and bootstraps `.github/workflows/ci.yml` from real repo commands (unit + e2e), writes only after human approval, and requires a **green** Actions run (`verifyWorkflowRun`) before proceeding; validation commands fall back to real `package.json` scripts
- Assignee-hygiene (symmetric): a **proposing** step assigns the role-owner (po/qa/dev) before a gate; a **consuming** step (import / qa-update-approved / dev-update-approved / decompose) clears the assignee once no proposal remains undecided
- Background advance: `npx tsx scripts/orchestrate.mts --project=KEY [--dry|--once]` polls Jira by an `updated`-cursor (`state/<project>.json`, git-ignored), resolves each changed issue's stage and advances it — generative steps via the agent skill, deterministic steps (import/apply/decompose) on a satisfied human gate
- Self-approval guard: AI-authored comments **must** carry `[AI-generated]` (`JiraClient.addAiComment` enforces it); the approval reader never counts an AI comment (`approvesProposal`), so no automation step can take over the human approver role — locked by battle tests (approval/importer/orchestrator) + `ai-comment` guard
- Operator auto-gates (feature-flagged, **off** by default): `AIALM_GATE_MODE=human|delegate|llm` (+ `--mode` override) controls `npx tsx scripts/gate-auto.mts --repo=owner/name`. `delegate` blindly posts `[delegated] APPROVE:<id>` for every undecided proposal; `llm` asks an LLM gate agent (read-only `opencode run`) for an `approve|reject|comment|defer` verdict and applies it on the labelled `[delegated][llm]` channel — including the final PR gate. Both modes intentionally bend the *never machine-approved* principle: enable only when you explicitly delegate your gate decisions. Budget per pass via `--max-actions` (default 20); malformed/unsure verdicts always defer

## Setup

```bash
cp .env.example .env   # fill in Jira credentials
npm install
npm run typecheck && npm test
```

## Run in Docker / Kubernetes

Two runtime targets built from one multi-stage Dockerfile: `runtime` (lean
orchestrator + agent runner, **no browser**) and `board` (+ Playwright/chromium
for Jira board UI automation).

```bash
npm run docker:build            # runtime image (ai-alm-oss:local)
npm run docker:smoke            # one dry pass against real Jira (needs PROJECT)
docker compose up -d orchestrator   # or: npm run docker:up
```

The generative skill runner is pluggable via `AIALM_SKILL_RUNNER`:
`subprocess` (in-process, local dev / compose smoke) or `k8s` (one ephemeral
**Job per agentic step** — kind / cloud; orchestrator reconciles outcomes each
poll pass). Isolated per-task environments keep agent work from colliding in a
shared working tree.

Deploy to a local `kind` cluster or to cloud (EKS/GKE/AKS) from
`deploy/kustomize` — see **`deploy/README.md`** for the full matrix, the RWX
shared-volume caveat, and the Secrets to provision.

- Async generative dispatch: the poller enqueues generative steps (po-analyze etc.) and a worker runs them as agent subprocesses — `advance` never blocks on the agent; deterministic steps run inline.
