/**
 * aialm-oss-dispatcher — trivial pool (banalny dispatcher).
 *
 * Skill does ALL Jira interaction (IN_PROGRESS_BY_AGENT → AWAITING_HUMAN_APPROVAL
 * per AGENTS.md exclusive mutator). Dispatcher only:
 *   - scans JQL status="AWAITS AGENT PICKUP" (project) where AIALM AGENT is set,
 *   - `docker run -d` a container per ticket `opencode run <agent> <key>`,
 *   - surfaces logs via `docker logs`.
 *
 * No Jira state mutation here. No daemon — one-shot with optional --watch.
 *
 * Usage:
 *   npm run dispatcher -- --project=WELLBEINGT              # dispatch all pickup (detached, show logs)
 *   npm run dispatcher -- --project=WELLBEINGT --dry        # list without docker
 *   npm run dispatcher -- --project=WELLBEINGT --limit=5    # cap
 *   npm run dispatcher -- --status [--project=WELLBEINGT]   # inspect dispatched containers
 *   npm run dispatcher -- --status --watch [--project=WELLBEINGT]  # tail logs until containers done
 *   npm run dispatcher -- --logs=<container|key>             # docker logs --tail 100
 */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JiraClient } from '../src/aialm/oss/adapter/jira.js';
import { loadDotEnv, jiraConfig } from '../src/aialm/oss/adapter/config.js';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.js';
import {
  scanPickupTickets,
  buildDockerRunSpec,
  parseInspectJson,
  correctedOpencodeConfig,
  DISPATCH_LABEL,
  DISPATCH_IMAGE_DEFAULT,
} from '../src/aialm/oss/dispatcher/index.js';

loadDotEnv(process.cwd());

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
    else if (a === '--dry') out.dry = true;
    else if (a === '--status') out.status = true;
    else if (a === '--watch') out.watch = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage(): void {
  console.log(`aialm-oss-dispatcher — banalny pool (skill robi całą Jirę)

Uzycie:
  npm run dispatcher -- --project=WELLBEINGT [--dry] [--limit=N]
  npm run dispatcher -- --status [--project=WELLBEINGT] [--watch]
  npm run dispatcher -- --logs=<containerId|name|WELLBEINGT-N> [--tail=N]

Opcje:
  --project=KEY   Jira project key (wymagane dla dispatch; dla --status filtruje listing)
  --dry           tylko wypisz co by sie odpalilo (bez dockera)
  --limit=N       max ticketow na przebieg (default 20)
  --status        listing kontenerow (docker ps+inspect) — filtrowane po label ${DISPATCH_LABEL}
  --watch         przy --status: live tail (docker logs -f) az kontenery skoncza (Ctrl+C)
  --logs=ID       docker logs --tail 100 dla kontenera (id/name/key)
  --tail=N        tail dla --logs (default 100)
  --image=REF     docker image (default ${DISPATCH_IMAGE_DEFAULT})
  --help          help
`);
}

function sh(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string; code: number | null } {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  return { ok: (r.status ?? 1) === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const project = typeof args.project === 'string' ? String(args.project).toUpperCase() : undefined;
  const image = typeof args.image === 'string' ? String(args.image) : DISPATCH_IMAGE_DEFAULT;
  const limit = typeof args.limit === 'string' ? Number(args.limit) : 20;
  const tail = typeof args.tail === 'string' ? Number(args.tail) : 100;
  const hostCwd = process.env.DISPATCH_HOST_CWD || process.cwd();
  // Detect if running inside a Docker container (sibling dispatcher pattern).
  // When running inside Docker, homedir() returns container paths (e.g. /root)
  // which don't exist on the Docker host — skip host auth mounts.
  const runningInDocker = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  console.log(`[dispatcher] runningInDocker=${runningInDocker} homedir=${homedir()}`);
  // Mount host opencode auth only when explicitly requested (avoids stale jira token override).
  const hostOpencodeDir = process.env.DISPATCH_MOUNT_OPENCODE && !runningInDocker ? join(homedir(), '.config', 'opencode') : undefined;
  const opencodeDirExists = !!hostOpencodeDir && existsSync(hostOpencodeDir) && statSync(hostOpencodeDir).isDirectory();
  // Corrected opencode.json where `jira` MCP points to the dispatch target site (JIRA_SITE, e.g. ai-alm-oss)
  // so `jira_jira_*` is correct for WELLBEINGT. Without this, `jira` would be paligakrzychu and fail for ai-alm-oss.
  const jiraSite = process.env.JIRA_SITE?.trim() ?? 'https://ai-alm-oss.atlassian.net';
  const opencodeAuthPath = join(homedir(), '.config', 'opencode', 'auth.json');
  const opencodeAuthExists = !runningInDocker && existsSync(opencodeAuthPath);
  const opencodeLocalAuthPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
  const opencodeLocalAuthExists = !runningInDocker && existsSync(opencodeLocalAuthPath);
  const dispatchModel = process.env.OPENCODE_MODEL ?? process.env.AIALM_MODEL ?? undefined;
  // Write corrected config to a temp file and mount as /app/opencode.json (single `jira` MCP, correct site).
  // When running inside Docker, write to the mounted workspace so Docker can mount it.
  const inDocker = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  const containerBase = inDocker ? '/app' : tmpdir();
  const hostBase = inDocker ? join(hostCwd, '.opencode-corrected') : tmpdir();
  const configFile = `aialm-dispatch-${project ?? 'unknown'}-${Date.now()}.json`;
  let correctedConfigMounted: string | undefined;
  if (project) {
    try {
      mkdirSync(join(containerBase, '.opencode-corrected'), { recursive: true });
      const containerPath = join(containerBase, '.opencode-corrected', configFile);
      writeFileSync(containerPath, correctedOpencodeConfig(jiraSite), 'utf8');
      correctedConfigMounted = join(hostBase, configFile);
    } catch {
      correctedConfigMounted = undefined;
    }
  }

  // --logs=<id>
  if (typeof args.logs === 'string') {
    const target = String(args.logs);
    // Resolve key → container via label filter if target looks like a ticket key
    let cid = target;
    if (/^[A-Z][A-Z0-9_]+-\d+$/.test(target)) {
      const r = sh('docker', ['ps', '-a', '--filter', `label=${DISPATCH_LABEL}=${target}`, '--format', '{{.ID}}']);
      const ids = r.stdout.trim().split('\n').filter(Boolean);
      if (!ids.length) {
        console.error(`no container for key ${target} (label ${DISPATCH_LABEL}=${target})`);
        process.exit(1);
      }
      // newest first from docker ps order; pick first
      cid = ids[0]!;
      console.log(`# key ${target} → container ${cid}`);
    }
    const p = spawn('docker', ['logs', '--tail', String(tail), cid], { stdio: 'inherit' });
    p.on('close', code => process.exit(code ?? 0));
    p.on('error', e => { console.error(String((e as Error).message)); process.exit(1); });
    return;
  }

  // --status (listing; no Jira needed unless filtering needs nothing else)
  if (args.status) {
    const filterArgs = project ? ['--filter', `label=aialm.project=${project}`] : ['--filter', `label=${DISPATCH_LABEL}`];
    // We add aialm.dispatch label filter to restrict to dispatcher containers only
    const ps = sh('docker', ['ps', '-a', '--filter', `label=${DISPATCH_LABEL}`, ...filterArgs, '--format', '{{.ID}}']);
    if (!ps.ok) {
      console.error(`docker ps failed: ${ps.stderr || ps.stdout}`);
      process.exit(1);
    }
    const ids = ps.stdout.trim().split('\n').filter(Boolean);
    if (!ids.length) {
      console.log('(no dispatcher containers)');
      if (project) console.log(`  (filtered by project ${project}, label ${DISPATCH_LABEL})`);
      return;
    }
    console.log(`dispatcher containers (${ids.length}):`);
    for (const id of ids) {
      const insp = sh('docker', ['inspect', id]);
      if (!insp.ok) {
        console.log(`  ${id}: inspect failed: ${insp.stderr.slice(0, 200)}`);
        continue;
      }
      const st = parseInspectJson(insp.stdout);
      if (!st) { console.log(`  ${id}: parse failed`); continue; }
      const health = st.health ? ` health=${st.health}` : '';
      const exit = st.exitCode !== undefined ? ` exit=${st.exitCode}` : '';
      console.log(`  ${st.name || id} [${st.key || '?'}] state=${st.state}${health}${exit} id=${st.id}`);
      if (st.key && st.state) {
        // show tail
        const lr = sh('docker', ['logs', '--tail', '20', id]);
        const tailOut = (lr.stdout + lr.stderr).trim().split('\n').slice(-20).join('\n');
        if (tailOut) console.log(`    logs tail:\n${tailOut.split('\n').map(l => `    | ${l}`).join('\n')}`);
      }
    }

    if (args.watch) {
      // --watch: stream logs -f for each running container, then re-list until all done
      const runningIds = ids.filter(id => {
        const insp = sh('docker', ['inspect', id]);
        const st = insp.ok ? parseInspectJson(insp.stdout) : null;
        return st?.state === 'running';
      });
      if (!runningIds.length) {
        console.log('no running containers to watch');
        return;
      }
      console.log(`\n--watch: streaming logs for ${runningIds.length} running container(s) (Ctrl+C to stop)…`);
      await new Promise<void>((resolve, reject) => {
        let remaining = runningIds.length;
        const children: ReturnType<typeof spawn>[] = [];
        const onClose = () => {
          remaining--;
          if (remaining <= 0) resolve();
        };
        for (const id of runningIds) {
          const c = spawn('docker', ['logs', '-f', '--tail', '50', id], { stdio: 'inherit' });
          children.push(c);
          c.on('close', onClose);
          c.on('error', reject);
        }
        process.on('SIGINT', () => {
          for (const c of children) c.kill();
          resolve();
        });
      });
      console.log('\n--watch done. Re-run --status to confirm.');
    }
    return;
  }

  // dispatch path — requires --project
  if (!project) {
    usage();
    console.error('\nMissing --project=KEY (e.g. --project=WELLBEINGT).');
    process.exit(1);
  }

  const jira = new JiraClient({ config: jiraConfig() });
  const cids = await ensureSelfAwareFields(jira, project);
  // Auto-sync fork main → upstream main (W15 → d009c2c) so next wave (W5) doesn't branch from stale ee0d6cd.
  // Best-effort, only for WELLBEINGT (hardcoded upstream steamnoid/wellbeing-tracker-public → fork paligakrzychu).
  if (project === 'WELLBEINGT') {
    try {
      const { syncForkMain } = await import('../src/aialm/oss/shared/git-ops.js');
      const r = await syncForkMain('steamnoid', 'wellbeing-tracker-public', 'paligakrzychu');
      if (r.synced) console.log(`fork sync: paligakrzychu:main ${r.forkSha.slice(0, 7)} → ${r.upstreamSha.slice(0, 7)} (upstream steamnoid)`);
    } catch (e) {
      console.log(`fork sync skip: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  const tickets = await scanPickupTickets(jira, project, cids, { limit });
  if (!tickets.length) {
    console.log(`no tickets in AWAITS AGENT PICKUP for ${project} (limit ${limit})`);
    return;
  }

  console.log(`pickup in ${project}: ${tickets.length} ticket(s) (AWAITS AGENT PICKUP)`);
  for (const t of tickets) console.log(`  ${t.key} → ${t.agent} [${t.stage}]`);

  if (args.dry) {
    console.log('(dry — not launching containers)');
    for (const t of tickets) {
      const spec = buildDockerRunSpec(
        { key: t.key, agent: t.agent },
        {
          projectKey: project,
          image,
          hostCwd: hostCwd,
          hostOpencodeConfigDir: opencodeDirExists ? hostOpencodeDir : undefined,
          hostOpencodeConfigPath: correctedConfigMounted,
          hostOpencodeAuthPath: opencodeAuthExists ? opencodeAuthPath : undefined,
          hostOpencodeLocalAuthPath: opencodeLocalAuthExists ? opencodeLocalAuthPath : undefined,
          model: dispatchModel,
          nameSuffix: 'dry',
        },
      );
      console.log(`  would run: docker ${spec.args.join(' ')}`);
    }
    return;
  }

  // Launch detached containers — skill inside does all Jira I/O.
  for (const t of tickets) {
    const spec = buildDockerRunSpec(
      { key: t.key, agent: t.agent },
      {
        projectKey: project,
        image,
        hostCwd: hostCwd,
        hostOpencodeConfigDir: opencodeDirExists ? hostOpencodeDir : undefined,
        hostOpencodeConfigPath: correctedConfigMounted,
        hostOpencodeAuthPath: opencodeAuthExists ? opencodeAuthPath : undefined,
        hostOpencodeLocalAuthPath: opencodeLocalAuthExists ? opencodeLocalAuthPath : undefined,
        model: dispatchModel,
      },
    );
    console.log(`\n→ dispatch ${t.key} (${t.agent}) → container ${spec.containerName}`);
    console.log(`  docker ${spec.args.join(' ')}`);
    const r = sh('docker', spec.args);
    if (!r.ok) {
      console.error(`  failed: ${r.stderr || r.stdout}`.slice(0, 2000));
      continue;
    }
    const cid = r.stdout.trim();
    console.log(`  dispatched: ${cid} (${spec.containerName})`);
    console.log(`  logs: docker logs ${cid}  |  docker logs -f ${cid}  |  npm run dispatcher -- --logs=${t.key}`);
    // Show initial logs tail (skill may not have emitted yet — best-effort, non-blocking)
    const lr = sh('docker', ['logs', '--tail', '30', cid]);
    const out = (lr.stdout + lr.stderr).trim();
    if (out) console.log(`  logs tail:\n${out.split('\n').map(l => `  | ${l}`).join('\n')}`);
  }

  console.log(`\ndone. ${tickets.length} dispatched (detached).`);
  console.log(`  status: npm run dispatcher -- --status --project=${project}`);
  console.log(`  watch:  npm run dispatcher -- --status --watch --project=${project}`);
}

main().catch(e => {
  console.error('dispatcher failed:', (e as Error).message);
  process.exit(1);
});
