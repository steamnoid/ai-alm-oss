import { spawn } from 'node:child_process';
import { JiraClient } from '../src/aialm/oss/alm/jira.ts';
import { jiraBotConfig, loadDotEnv } from '../src/aialm/oss/shared/config.ts';
import { provisionRepoBoard } from '../src/aialm/oss/board/provision.ts';
import { parseRepoRef, repoKey } from '../src/aialm/oss/board/flags.ts';

/**
 * One-shot governed pipeline: provision → discover → orchestrate.
 *
 *   1. provision (REST)  — ensure the project + 15 role statuses (no UI needed;
 *                          the pipeline drives issues by status via REST).
 *   2. discover (agent)  — `opencode run aialm-oss-discover <owner>/<repo>` scans
 *                          open issues and persists qualified candidates.
 *   3. orchestrate       — spawns the governed background poller (daemon) for the
 *                          project; it advances candidates through PO→QA→ARCH→SEC→
 *                          DEV→impl→verify→PR as gates are approved.
 *
 * Requires --repo (owner/name). The project key is derived deterministically from
 * the repo name (deriveProjectKey). The discover step is LLM-driven and needs the
 * `aialm-oss-discover` skill + MCP Jira (bot).
 *
 * Usage:
 *   npx tsx scripts/run-pipeline.mts --repo=steamnoid/wellbeing-tracker-public \
 *     [--workers=4] [--genWorkers=1] [--interval=30]
 */

interface Args {
  repo: string;
  workers: number;
  genWorkers: number;
  interval: number;
  once: boolean;
}

function parseArgs(): Args {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
    else if (a === '--once') out.once = '1';
  }
  return {
    repo: out.repo ?? '',
    workers: Number(out.workers ?? 4),
    genWorkers: Number(out.genWorkers ?? 1),
    interval: Number(out.interval ?? 30),
    once: out.once === '1',
  };
}

async function log(msg: string): Promise<void> {
  console.log(`[run-pipeline] ${msg}`);
}

/** Run an opencode skill as a child agent subprocess (blocks until it exits). */
function runSkill(skill: string, arg: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['opencode', 'run', skill, arg], { stdio: 'inherit' });
    child.on('close', (code) => resolvePromise(code ?? 0));
    child.on('error', () => resolvePromise(1));
  });
}

/** Phase 1 — REST-only provision: ensure project + 15 role statuses exist. */
async function provisionREST(repo: string): Promise<void> {
  const jira = new JiraClient({ config: jiraBotConfig() });
  const { owner, repo: repoName } = parseRepoRef(repo);
  const me = await jira.myself();
  const r = await provisionRepoBoard(jira, { owner, repo: repoName, leadAccountId: me.accountId });
  await log(
    `provision: project ${r.projectKey} ${r.name} ${r.created ? 'created' : 'exists (reuse)'}` +
      ` | statuses created=${r.statuses.created} skipped=${r.statuses.skipped}` +
      (r.statuses.existing.length ? ` existing=[${r.statuses.existing.join(', ')}]` : ''),
  );
}

/** Phase 2 — agent discover of candidate work items from the public repo. */
async function discover(repo: string): Promise<void> {
  await log(`discover: running aialm-oss-discover on ${repo} (agent)`);
  const code = await runSkill('aialm-oss-discover', repo);
  if (code !== 0) await log(`discover: agent exited with code ${code}`);
}

/** Phase 3 — orchestrate: spawn the governed background poller (daemon). */
function orchestrate(project: string, args: Args): Promise<number> {
  return new Promise((resolvePromise) => {
    const daemonArgs = [
      'tsx',
      'scripts/orchestrate.mts',
      `--project=${project}`,
      `--workers=${args.workers}`,
      `--genWorkers=${args.genWorkers}`,
      `--interval=${args.interval}`,
    ];
    if (args.once) daemonArgs.push('--once');
    const child = spawn('npx', daemonArgs, { stdio: 'inherit' });
    child.on('close', (code) => resolvePromise(code ?? 0));
    child.on('error', () => resolvePromise(1));
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs();
  const site = jiraBotConfig().site;
  if (!args.repo) throw new Error('--repo=owner/name is required');
  const project = repoKey(args.repo);
  await log(`site=${site} project=${project} repo=${args.repo} once=${args.once}`);

  // Phase 1 — REST-only provision (no session UI, no 2FA).
  await provisionREST(args.repo);

  // Phase 2 — discover candidates.
  await discover(args.repo);

  // Phase 3 — orchestrate daemon.
  await log(`orchestrate: starting daemon for ${project} (workers=${args.workers} genWorkers=${args.genWorkers} interval=${args.interval}s)`);
  const code = await orchestrate(project, args);
  if (code !== 0) await log(`orchestrate: daemon exited with code ${code}`);
}

main().catch((e) => {
  console.error('[run-pipeline] failed:', e);
  process.exit(1);
});
