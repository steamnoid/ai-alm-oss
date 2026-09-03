---
description: Hunt AWAITS AGENT PICKUP tickets and dispatch each skill in a detached Docker container; skill owns all Jira I/O.
---

Hunt `AWAITS AGENT PICKUP` tickets and dispatch each skill in a detached Docker container. Skill does all Jira I/O.

Args: $ARGUMENTS (flags: --project=WELLBEINGT [--dry] [--limit=N] [--status] [--watch] [--logs=<id|key>] [--image=REF])

Execute the `aialm-oss-dispatcher` skill (`.opencode/skills/aialm-oss-dispatcher/SKILL.md`):

1. Scan JQL `status="AWAITS AGENT PICKUP"` for the project; read `AIALM AGENT` per ticket (= skill name).
2. For each, `docker run -d --name aialm-<proj>-<key>-<ent> --label aialm.dispatch=<key> --health-cmd 'ps aux | grep -q "[o]pencode"' <image> npx opencode run <skill> <key>` (host mounts: $(pwd):/app, ~/.config/opencode:ro, --env-file .env). Skill owns all Jira.
3. Print container ids + `docker logs` handles; `--status` lists via `docker ps -a --filter label=aialm.dispatch` + `docker inspect` + logs tail; `--status --watch` streams `docker logs -f` until done.
4. No Jira state mutation in the dispatcher (trivial pool).
