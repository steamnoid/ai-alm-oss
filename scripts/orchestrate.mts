import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { JiraClient } from '../src/aialm/oss/alm/jira.ts';
import { advance } from '../src/aialm/oss/orchestrator/advance.ts';
import { claimQueued, failUnrefRunning, markDone, markFailed } from '../src/aialm/oss/orchestrator/queue.ts';
import { analyzeDrift } from '../src/aialm/oss/orchestrator/drift.ts';
import {
  K8sJobSkillRunner,
  SubprocessSkillRunner,
  applyOutcomes,
  dispatchQueuedK8s,
  makeSkillRunner,
} from '../src/aialm/oss/orchestrator/runner.ts';
import { jiraBotConfig, loadDotEnv } from '../src/aialm/oss/shared/config.ts';

const LOCK = '.orchestrate.lock';
const LOCK_STALE_MS = 5 * 60_000;

function acquireLock(): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx', 0o644);
      writeFileSync(fd, `${process.pid}:${Date.now()}`);
      closeSync(fd);
      // ensure cleanup on signals
      const release = () => { try { if (existsSync(LOCK)) { const c = readFileSync(LOCK, 'utf8'); if (c.startsWith(String(process.pid))) unlinkSync(LOCK); } } catch {} };
      process.on('SIGINT', () => { release(); process.exit(130); });
      process.on('SIGTERM', () => { release(); process.exit(143); });
      return;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw e;
      // stale detection: pid dead or timestamp too old
      try {
        const raw = readFileSync(LOCK, 'utf8');
        const [pidStr, tsStr] = raw.split(':');
        const pid = Number(pidStr);
        const ts = Number(tsStr ?? 0);
        let dead = false;
        if (pid) { try { process.kill(pid, 0); } catch { dead = true; } } else dead = true;
        const stale = ts ? (Date.now() - ts > LOCK_STALE_MS) : false;
        if (dead || stale) {
          console.warn(`orchestrate: stale lock detected (pid=${pidStr} ts=${tsStr} dead=${dead} stale=${stale}) — removing`);
          unlinkSync(LOCK);
          continue;
        }
      } catch {}
      console.error('orchestrate: lock present (already running) — exiting');
      process.exit(2);
    }
  }
  console.error('orchestrate: failed to acquire lock after retries — exiting');
  process.exit(2);
}

function releaseLock(): void {
  try {
    if (!existsSync(LOCK)) return;
    const raw = readFileSync(LOCK, 'utf8');
    if (raw.startsWith(String(process.pid))) unlinkSync(LOCK);
  } catch {}
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
    else if (a === '--dry') out.dry = '1';
    else if (a === '--once') out.once = '1';
  }
  return out;
}

const args = parseArgs();
const projectKey = args.project;
const dry = Boolean(args.dry);
const intervalSec = Number(args.interval ?? 30);
const workers = Number(args.workers ?? 2); // parallel issues per pass — 2+2 default for low-memory docker/host
const genWorkers = Number(args.genWorkers ?? 2); // concurrent agent executions — 2+2
const once = Boolean(args.once);

if (!projectKey) {
  console.error('usage: npx tsx scripts/orchestrate.mts --project=KEY [--dry] [--once] [--interval=30] [--workers=2] [--genWorkers=2]');
  process.exit(1);
}
acquireLock();
// The governed pipeline runs against the dedicated bot site (WELLBEINGT lives
// on paligakrzychu.atlassian.net), so use the bot config. loadDotEnv() also
// populates process.env with JIRA_BOT_* so "opencode run <skill>" child
// processes (which resolve MCP env via {env:...}) inherit the bot creds.
loadDotEnv();
// Runner seam is constructed after loadDotEnv() so AIALM_SKILL_RUNNER /
// POD_NAMESPACE / AIALM_IMAGE can come from .env as well as the pod env.
const runner = makeSkillRunner();
console.log(`orchestrate: skill runner = ${runner.kind}`);
const jiraOpts = { config: jiraBotConfig() };
const jira = new JiraClient(jiraOpts);

async function poll(): Promise<void> {
  // 1) advance deterministic stages + enqueue generative jobs (never spawns agents)
  const res = await advance(jira, { projectKey, dry, workers });
  console.log(`[${new Date().toISOString()}] ${projectKey} scanned=${res.scanned} actions=${res.actions.length} cursor=${res.cursor ?? '(none)'}`);
  for (const a of res.actions) console.log(`   ${a.key} -> ${a.action}: ${a.detail}`);
  // 2) live drift analysis host ↔ Jira (cursor, queue, workdir/branch)
  if (!dry) {
    try {
      const drift = await analyzeDrift(jira, projectKey);
      if (drift.warnings.length) {
        for (const w of drift.warnings) console.warn(`[drift] ${w}`);
      } else if (drift.checked) {
        console.log(`[drift] host↔Jira in sync (cursor=${drift.cursor ?? 'none'} queue=${drift.queueSummary})`);
      }
    } catch (e) { console.warn(`[drift] check failed: ${(e as Error).message}`); }
  }
  if (dry || once === undefined) return;
}

async function drainQueue(): Promise<void> {
  if (dry) return;
  if (runner instanceof K8sJobSkillRunner) {
    // crash recovery: running-without-ref entries belong to dead processes
    const recovered = failUnrefRunning(projectKey);
    if (recovered) console.log(`[gen] recovered ${recovered} undispatched entr(y/ies)`);
    // 0) reconcile previously dispatched Jobs (crash-safe: refs live in the queue)
    applyOutcomes(projectKey, await runner.reconcile(projectKey));
    // 1) claim queued jobs and create their ephemeral Jobs
    const claimed = claimQueued(projectKey, genWorkers);
    if (claimed.length) await dispatchQueuedK8s(runner, projectKey, claimed);
    return;
  }
  const sub = runner as SubprocessSkillRunner;
  for (;;) {
    const jobs = claimQueued(projectKey, genWorkers);
    if (!jobs.length) return;
    // Intra-wave serialization: jobs sharing the same targetKey (e.g. qa-impl ∥ dev-impl)
    // share .work/<wave> and the same git branch — running them concurrently on host
    // clobbers the clone (rm -rf race). Group by targetKey: parallel across waves,
    // sequential within a wave.
    const groups = new Map<string, typeof jobs>();
    for (const j of jobs) {
      const g = groups.get(j.targetKey) ?? [];
      g.push(j);
      groups.set(j.targetKey, g);
    }
    await Promise.all([...groups.values()].map(async (group) => {
      for (const j of group) {
        console.log(`[gen] ${j.skill} on ${j.targetKey} (ref ${j.repoRef})`);
        try {
          await sub.run(j);
          markDone(projectKey, j.id);
          console.log(`[gen done] ${j.skill} ${j.targetKey}`);
        } catch (e) {
          markFailed(projectKey, j.id, (e as Error).message);
          console.error(`[gen failed] ${j.skill} ${j.targetKey}: ${(e as Error).message}`);
        }
      }
    }));
  }
}

try {
  // Startup recovery (any runner): running entries left by a dead process
  // (crash / restart between claim and completion) must not stall stages.
  const recovered = failUnrefRunning(projectKey);
  if (recovered) console.log(`orchestrate: recovered ${recovered} interrupted job(s)`);
  await poll();       // first pass
  await drainQueue(); // then drain any enqueued generative work
  while (!once) {
    await new Promise(r => setTimeout(r, intervalSec * 1000));
    try {
      await poll();
      await drainQueue();
    } catch (e) {
      console.error('orchestrate: pass error', (e as Error).message);
    }
  }
} finally {
  releaseLock();
  console.log('orchestrate: stopped');
}
