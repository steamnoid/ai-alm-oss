import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface GenerativeJob {
  id: string; // skill+targetKey dedupe key
  skill: string;
  targetKey: string;
  repoRef: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  error?: string;
  /** External execution handle (e.g. K8s Job name) for dispatched jobs. */
  externalRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerativeQueue {
  jobs: GenerativeJob[];
}

function queuePath(projectKey: string): string {
  return resolve('state', `${projectKey}.queue.json`);
}

function load(projectKey: string): GenerativeQueue {
  const p = queuePath(projectKey);
  if (!existsSync(p)) return { jobs: [] };
  try {
    const q = JSON.parse(readFileSync(p, 'utf8')) as GenerativeQueue;
    if (!Array.isArray(q.jobs)) return { jobs: [] };
    return q;
  } catch {
    return { jobs: [] };
  }
}

function atomicWriteJson(targetPath: string, data: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, targetPath);
}

function save(projectKey: string, q: GenerativeQueue): void {
  // keep only the most recent jobs (retention)
  const MAX = 100;
  const trimmed = q.jobs.length > MAX ? q.jobs.slice(q.jobs.length - MAX) : q.jobs;
  atomicWriteJson(queuePath(projectKey), JSON.stringify({ jobs: trimmed }, null, 2));
}

function jobKey(skill: string, targetKey: string): string {
  return `${skill}#${targetKey}`;
}

/** Enqueue a generative job; dedupes on skill+targetKey for queued/running jobs. */
export function enqueueGenerative(
  projectKey: string,
  job: { skill: string; targetKey: string; repoRef: string },
): { enqueued: boolean; id: string } {
  const q = load(projectKey);
  const key = jobKey(job.skill, job.targetKey);
  const active = q.jobs.find(j => j.id === key && (j.status === 'queued' || j.status === 'running'));
  if (active) return { enqueued: false, id: key };
  const now = new Date().toISOString();
  q.jobs.push({ id: key, ...job, status: 'queued', attempts: 0, createdAt: now, updatedAt: now });
  save(projectKey, q);
  return { enqueued: true, id: key };
}

/** Is a generative job already queued/running for this target? */
export function hasActiveJob(projectKey: string, skill: string, targetKey: string): boolean {
  const q = load(projectKey);
  return q.jobs.some(j => j.id === jobKey(skill, targetKey) && (j.status === 'queued' || j.status === 'running'));
}

/** Claim up to `limit` queued jobs (marks them running). Jobs that already
 * exceeded MAX_ATTEMPTS are resolved as failed instead of retried forever. */
const MAX_ATTEMPTS = 5;
export function claimQueued(projectKey: string, limit = 1): GenerativeJob[] {
  const q = load(projectKey);
  const claimed: GenerativeJob[] = [];
  const now = new Date().toISOString();
  for (const j of q.jobs) {
    if (claimed.length >= limit) break;
    if (j.status !== 'queued') continue;
    if (j.attempts >= MAX_ATTEMPTS) {
      j.status = 'failed';
      j.error = `max attempts (${MAX_ATTEMPTS}) exhausted`;
      j.updatedAt = now;
      continue;
    }
    j.status = 'running';
    j.attempts += 1;
    j.updatedAt = now;
    claimed.push(j);
  }
  save(projectKey, q);
  return claimed;
}

export function markDone(projectKey: string, id: string): void {
  const q = load(projectKey);
  const j = q.jobs.find(x => x.id === id);
  if (j) { j.status = 'done'; j.updatedAt = new Date().toISOString(); }
  save(projectKey, q);
}

export function markFailed(projectKey: string, id: string, error?: string): void {
  const q = load(projectKey);
  const j = q.jobs.find(x => x.id === id);
  if (j) { j.status = 'failed'; j.error = error; j.updatedAt = new Date().toISOString(); }
  save(projectKey, q);
}

/** Record the external execution handle of a running job (idempotent). */
export function setExternalRef(projectKey: string, id: string, ref: string): void {
  const q = load(projectKey);
  const j = q.jobs.find(x => x.id === id);
  if (j && !j.externalRef) { j.externalRef = ref; j.updatedAt = new Date().toISOString(); }
  save(projectKey, q);
}

/** Running jobs that were dispatched to an external executor. */
export function listRunningExternal(projectKey: string): GenerativeJob[] {
  return load(projectKey).jobs.filter(j => j.status === 'running' && j.externalRef);
}

/**
 * Startup/crash recovery: running entries without an externalRef mean the
 * orchestrator died between claiming and recording the dispatch handle.
 * Nothing owns them — resolve as failed so stages can re-enqueue.
 */
export function failUnrefRunning(projectKey: string, reason = 'interrupted before dispatch'): number {
  const q = load(projectKey);
  let n = 0;
  const now = new Date().toISOString();
  for (const j of q.jobs) {
    if (j.status === 'running' && !j.externalRef) {
      j.status = 'failed';
      j.error = reason;
      j.updatedAt = now;
      n++;
    }
  }
  if (n) save(projectKey, q);
  return n;
}
