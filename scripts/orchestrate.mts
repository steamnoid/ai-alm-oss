import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { JiraClient } from '../src/aialm/oss/alm/jira.ts';
import { advance } from '../src/aialm/oss/orchestrator/advance.ts';
import { claimQueued, markDone, markFailed } from '../src/aialm/oss/orchestrator/queue.ts';

const LOCK = '.orchestrate.lock';

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

/** Run one generative skill as an agent subprocess; never blocks the poller. */
function runSkill(skill: string, targetKey: string, repoRef: string): Promise<void> {
  return new Promise((resolvePromise) => {
    const arg = repoRef || targetKey;
    const child = spawn('npx', ['opencode', 'run', skill, arg], { stdio: 'inherit' });
    child.on('close', (code) => resolvePromise());
    child.on('error', () => resolvePromise());
  });
}

const args = parseArgs();
const projectKey = args.project;
const dry = Boolean(args.dry);
const intervalSec = Number(args.interval ?? 30);
const workers = Number(args.workers ?? 4); // parallel issues per pass
const genWorkers = Number(args.genWorkers ?? 1); // concurrent agent subprocesses
const once = Boolean(args.once);

if (!projectKey) {
  console.error('usage: npx tsx scripts/orchestrate.mts --project=KEY [--dry] [--once] [--interval=30] [--workers=4] [--genWorkers=1]');
  process.exit(1);
}
if (existsSync(LOCK)) {
  console.error('orchestrate: lock present (already running) — exiting');
  process.exit(2);
}
writeFileSync(LOCK, String(process.pid));
const jira = new JiraClient();

async function poll(): Promise<void> {
  // 1) advance deterministic stages + enqueue generative jobs (never spawns agents)
  const res = await advance(jira, { projectKey, dry, workers });
  console.log(`[${new Date().toISOString()}] ${projectKey} scanned=${res.scanned} actions=${res.actions.length} cursor=${res.cursor ?? '(none)'}`);
  for (const a of res.actions) console.log(`   ${a.key} -> ${a.action}: ${a.detail}`);
  if (dry || once === undefined) return;
}

async function drainQueue(): Promise<void> {
  if (dry) return;
  for (;;) {
    const jobs = claimQueued(projectKey, genWorkers);
    if (!jobs.length) return;
    await Promise.all(jobs.map(async (j) => {
      console.log(`[gen] ${j.skill} on ${j.targetKey} (ref ${j.repoRef})`);
      try {
        await runSkill(j.skill, j.targetKey, j.repoRef);
        markDone(projectKey, j.id);
        console.log(`[gen done] ${j.skill} ${j.targetKey}`);
      } catch (e) {
        markFailed(projectKey, j.id, (e as Error).message);
        console.error(`[gen failed] ${j.skill} ${j.targetKey}: ${(e as Error).message}`);
      }
    }));
  }
}

try {
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
  if (existsSync(LOCK)) unlinkSync(LOCK);
  console.log('orchestrate: stopped');
}
