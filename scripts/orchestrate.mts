import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { JiraClient } from '../src/aialm/oss/alm/jira.ts';
import { advance } from '../src/aialm/oss/orchestrator/advance.ts';

type Arg = Extract<import('../src/aialm/oss/orchestrator/advance.ts').OrchestratorAction, { kind: 'GENERATE' }>;

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

/** Mode A generative advance: run the skill as an agent subprocess (LLM). */
function runGenerative(a: Arg): Promise<string> {
  const arg = a.repoRef || a.targetKey;
  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['opencode', 'run', a.skill, arg], { stdio: 'inherit' });
    child.on('close', (code) => resolvePromise(`generative:${a.skill}:${arg}:exit${code ?? '?'}`));
    child.on('error', (e) => resolvePromise(`generative-error:${a.skill}:${e.message}`));
  });
}

const args = parseArgs();
const projectKey = args.project;
const dry = Boolean(args.dry);
const intervalSec = Number(args.interval ?? 30);
const once = Boolean(args.once);

if (!projectKey) {
  console.error('usage: npx tsx scripts/orchestrate.mts --project=KEY [--dry] [--once] [--interval=30]');
  process.exit(1);
}

if (existsSync(LOCK)) {
  console.error('orchestrate: lock present (already running) — exiting');
  process.exit(2);
}
writeFileSync(LOCK, String(process.pid));

const jira = new JiraClient();

async function poll(): Promise<void> {
  const res = await advance(jira, { projectKey, dry, runGenerative });
  console.log(`[${new Date().toISOString()}] ${projectKey} scanned=${res.scanned} actions=${res.actions.length} cursor=${res.cursor ?? '(none)'}`);
  for (const a of res.actions) console.log(`   ${a.key} -> ${a.action}: ${a.detail}`);
}

try {
  // always one pass first (useful for manual `--once` / initial run)
  await poll();
  while (!once) {
    await new Promise(r => setTimeout(r, intervalSec * 1000));
    try {
      await poll();
    } catch (e) {
      console.error('orchestrate: pass error', (e as Error).message);
    }
  }
} finally {
  if (existsSync(LOCK)) unlinkSync(LOCK);
  console.log('orchestrate: stopped');
}
