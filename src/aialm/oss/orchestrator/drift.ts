import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JiraClient } from '../alm/jira.ts';

export interface DriftReport {
  checked: boolean;
  cursor: string | null;
  queueSummary: string;
  warnings: string[];
}

function queuePath(projectKey: string): string { return resolve('state', `${projectKey}.queue.json`); }
function statePath(projectKey: string): string { return resolve('state', `${projectKey}.json`); }

function loadQueue(projectKey: string): { jobs: Array<{ id: string; skill: string; targetKey: string; status: string; updatedAt: string; attempts: number }> } {
  const p = queuePath(projectKey);
  if (!existsSync(p)) return { jobs: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { jobs: [] }; }
}
function loadState(projectKey: string): { cursor: string | null; consumed?: string[] } {
  const p = statePath(projectKey);
  if (!existsSync(p)) return { cursor: null };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { cursor: null }; }
}

/**
 * Live drift between host (state + queue + .work) and Jira source of truth.
 * Called every poll pass; never throws (best-effort) and emits warnings for:
 *  - cursor lag (Jira updated newer than host cursor — missed delta)
 *  - queue staleness (queued/running job already completed in Jira comments)
 *  - orphan workdirs (stale .work/<key> without active wave)
 *  - ledger growth
 */
export async function analyzeDrift(jira: JiraClient, projectKey: string): Promise<DriftReport> {
  const warnings: string[] = [];
  const state = loadState(projectKey);
  const queue = loadQueue(projectKey);
  const qJobs = queue.jobs ?? [];

  // cursor + queue summary for log
  const active = qJobs.filter(j => j.status === 'queued' || j.status === 'running');
  const queueSummary = `${qJobs.length} total (${active.length} active)`;
  // ledger size warning
  const consumedLen = (state as { consumed?: unknown[] }).consumed?.length ?? 0;
  if (consumedLen > 400) warnings.push(`state ledger growing: consumed=${consumedLen} (trim at 500)`);

  // workdir drift: stale clones
  try {
    const workRoot = resolve('.work');
    if (existsSync(workRoot)) {
      const entries = readdirSync(workRoot);
      const activeKeys = new Set(active.map(j => j.targetKey));
      const waveKeys = new Set(qJobs.map(j => j.targetKey));
      for (const e of entries) {
        const full = resolve(workRoot, e);
        try {
          const st = statSync(full);
          if (!st.isDirectory()) continue;
          // stale if not in any wave and older than 24h
          const ageMs = Date.now() - st.mtimeMs;
          if (!waveKeys.has(e) && ageMs > 24 * 3600_000) {
            warnings.push(`orphan workdir .work/${e} age=${Math.round(ageMs/3600_000)}h no queue entry — consider cleanup`);
          } else if (activeKeys.has(e)) {
            // active wave should have recent mtime (< 2 * interval); if very old, agent may be stuck
            // soft warning only if queue running > 30min without progress
            const job = active.find(j => j.targetKey === e);
            if (job) {
              const updAge = Date.now() - new Date(job.updatedAt).getTime();
              if (updAge > 30 * 60_000 && job.status === 'running') {
                warnings.push(`running job ${job.id} age=${Math.round(updAge/60_000)}m — possible stuck agent (check .work/${e})`);
              }
            }
          }
        } catch {}
      }
      if (entries.length > 20) warnings.push(`.work has ${entries.length} wave dirs — high disk usage, consider pruning done waves`);
    }
  } catch {}

  // Jira-side drift: sample queued/running jobs and compare markers
  // Limit to 3 checks per poll to avoid spamming Jira.
  const toCheck = active.slice(0, 3);
  for (const j of toCheck) {
    try {
      const comments = await jira.listComments(j.targetKey);
      const hasMarker = comments.some(c => c.bodyText.includes(j.skill));
      // If marker already present but queue still queued/running → drift (already completed)
      // For impl skills the marker is skill name present; for generic, check substring.
      if (hasMarker && j.status !== 'done') {
        // double-check: if last attempt is recent, give it grace
        const age = Date.now() - new Date(j.updatedAt).getTime();
        if (age > 60_000) {
          warnings.push(`queue drift: ${j.id} status=${j.status} but Jira ${j.targetKey} already has marker '${j.skill}' — queue may need markDone`);
        }
      }
      // Check target still exists and is in expected project
      try {
        const issue = await jira.getIssue(j.targetKey, ['key', 'status']);
        const status = (issue.fields as { status?: { name?: string } })?.status?.name;
        if (status && /done|closed|resolved/i.test(status) && j.status === 'queued') {
          warnings.push(`queue drift: ${j.id} queued but Jira ${j.targetKey} status=${status} is terminal`);
        }
      } catch {}
    } catch (e) {
      const msg = (e as Error).message;
      if (/404/.test(msg)) warnings.push(`queue drift: ${j.id} target ${j.targetKey} not found in Jira (deleted or moved)`);
    }
  }

  // cursor lag: if host cursor is far behind Jira max updated, next poll will catch up but warn
  try {
    const cursor = state.cursor;
    if (cursor) {
      const cursorTime = new Date(cursor).getTime();
      if (!Number.isNaN(cursorTime)) {
        const lagMs = Date.now() - cursorTime;
        // Warn only if lag > 1h and there are no active jobs (otherwise lag is expected)
        if (lagMs > 3600_000 && active.length === 0) {
          // soft check: fetch one recent issue updated to see if cursor is stale
          const recent = await jira.searchJql(`project = ${projectKey} ORDER BY updated DESC`, ['updated'], 1);
          const newest = (recent[0]?.fields as { updated?: string })?.updated;
          if (newest && new Date(newest).getTime() - cursorTime > 600_000) {
            warnings.push(`cursor drift: host cursor ${cursor} is ${Math.round(lagMs/60_000)}m behind Jira newest ${newest} — delta may be large`);
          }
        }
      }
    }
  } catch {}

  return { checked: true, cursor: state.cursor, queueSummary, warnings };
}
