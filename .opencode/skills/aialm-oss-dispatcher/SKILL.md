---
name: aialm-oss-dispatcher
description: Trivial pool — hunts AWAITS AGENT PICKUP tickets and dispatches each skill in a detached Docker container; skill owns all Jira I/O.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — retired.

> **Philosophy — banalny dispatcher:** dispatcher does **zero** Jira state mutation. The skill running inside the container (`opencode run <agent> <key>`) does ALL Jira I/O per AGENTS.md (start → `IN_PROGRESS_BY_AGENT` + `AGENT WORKING`; end → `AWAITING_HUMAN_APPROVAL`). This keeps the orchestrator one-shot/no-daemon contract intact.

# aialm-oss-dispatcher — banalny pool (skill robi całą Jirę)

## Command

```
/aialm-oss-dispatcher [--project=WELLBEINGT] [--dry] [--limit=N] [--status] [--watch] [--logs=<id|key>]
```

Przykłady:
```
/aialm-oss-dispatcher --project=WELLBEINGT
/aialm-oss-dispatcher --project=WELLBEINGT --dry
/aialm-oss-dispatcher --status --project=WELLBEINGT
/aialm-oss-dispatcher --status --watch --project=WELLBEINGT
/aialm-oss-dispatcher --logs=WELLBEINGT-5
```

## Co robi agent (jeden przebieg)

1. **Scan:** `JQL status="AWAITS AGENT PICKUP"` dla projektu (`scanPickupTickets` w `dispatcher/index.ts`). Odczyt `AIALM AGENT` (CID) per ticket — wartość = nazwa skilla (`aialm-oss-po-analyze` …). Ignoruj `none`/puste.
2. **Dispatch (detached):** dla każdego `buildDockerRunSpec({key, agent}, {projectKey, image, hostCwd, hostOpencodeConfigDir})` → `docker run -d --name aialm-<proj>-<key>-<ent> --label aialm.dispatch=<key> --health-cmd 'ps aux | grep -q "[o]pencode"' <image> npx opencode run <skill> <key>`. Host mounts: `$(pwd):/app`, `~/.config/opencode:ro`, `--env-file $(pwd)/.env` (JIRA + opencode auth — secrets mounted, never baked).
3. **Logi:** po `docker run -d` wypisz `container id/name` + `docker logs <id>` handle. `--status` robi `docker ps -a --filter label=aialm.dispatch` + `docker inspect` + `docker logs --tail`.
4. **Watch:** `--status --watch` streamuje `docker logs -f` dla running kontenerów aż skończą (SIGINT kończy gracefully). Jednorazowy, bez demona — re-run pokazuje finalne statusy.
5. **Zero Jira mutacji w dispatcherze.** Wyłącznie skill w kontenerze mutuje krotkę + natywny status + treść.

## Invariants

- Dispatcher never writes `AIALM STAGE/ROLE/AGENT` or calls `transitionIssue`.
- Container HEALTHCHECK is **monitoring only** (`docker inspect --format '{{.State.Health.Status}}'`); Jira reconcile is owned by the skill.
- Secrets never baked into image — `--env-file .env` + `~/.config/opencode` mount.
