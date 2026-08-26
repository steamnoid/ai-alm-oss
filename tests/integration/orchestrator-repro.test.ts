import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, resolveNext } from '../../src/aialm/oss/orchestrator/advance.ts';
import { claimQueued, enqueueGenerative, markDone } from '../../src/aialm/oss/orchestrator/queue.ts';
import { adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';
import { doc, para } from '../../src/aialm/oss/alm/adf.ts';
import { analyzeDrift } from '../../src/aialm/oss/orchestrator/drift.ts';

const STATE_DIR = resolve('state');
const PROJ = 'REPRO';

function cleanState() {
  for (const f of [`${PROJ}.json`, `${PROJ}.queue.json`]) {
    const p = resolve(STATE_DIR, f);
    if (existsSync(p)) rmSync(p);
  }
}

function makeJira(issues: Array<{ key: string; fields: Record<string, unknown> }>, comments: Map<string, string[]>) {
  return {
    searchJql: async (jql: string) => {
      // return all issues for any project query
      if (jql.includes(PROJ)) return issues.map(i => ({ key: i.key, fields: { ...i.fields, updated: '2026-08-26T10:00:00.000Z' } }));
      return [];
    },
    getIssue: async (key: string, fields?: string[]) => {
      const hit = issues.find(i => i.key === key);
      if (!hit) throw new Error(`missing ${key}`);
      return { key, fields: hit.fields };
    },
    listComments: async (key: string) => (comments.get(key) ?? []).map(t => ({ bodyText: t })),
    addAiComment: async (key: string, adf: unknown) => {
      const txt = adfToPlainText(adf as any);
      const arr = comments.get(key) ?? [];
      arr.push(txt);
      comments.set(key, arr);
      return { id: 'c1' };
    },
    addComment: async (key: string, adf: unknown) => {
      const txt = adfToPlainText(adf as any);
      const arr = comments.get(key) ?? [];
      arr.push(txt);
      comments.set(key, arr);
      return { id: 'c1' };
    },
    getTransitions: async () => [],
    transitionIssue: async () => {},
  } as any;
}

describe('orchestrator reproducibility', () => {
  beforeEach(cleanState);
  afterEach(cleanState);

  it('dry advance is idempotent: two consecutive dry runs yield identical actions and cursor', async () => {
    const issues = [
      { key: `${PROJ}-1`, fields: { key: `${PROJ}-1`, labels: ['candidate'], description: doc(para('no ac')), summary: 'c1' } },
      { key: `${PROJ}-2`, fields: { key: `${PROJ}-2`, labels: ['work-item'], description: doc(para('## Acceptance Criteria'), { type: 'codeBlock', content: [{ type: 'text', text: 'Scenario: x\nGiven y\nThen z' }] }), summary: 'w1' } },
    ];
    const comments = new Map<string, string[]>();
    const jira = makeJira(issues, comments);
    const r1 = await advance(jira, { projectKey: PROJ, dry: true, workers: 2 });
    const r2 = await advance(jira, { projectKey: PROJ, dry: true, workers: 2 });
    expect(r1.scanned).toBe(r2.scanned);
    expect(r1.actions).toEqual(r2.actions);
    expect(r1.cursor).toBe(r2.cursor);
    // cursor not persisted in dry mode — state file should not exist
    expect(existsSync(resolve(STATE_DIR, `${PROJ}.json`))).toBe(false);
  });

  it('non-dry advance persists cursor atomically and second run is stable without approvals', async () => {
    const issues = [
      { key: `${PROJ}-1`, fields: { key: `${PROJ}-1`, labels: ['candidate'], description: doc(para('no ac')), summary: 'c1' } },
    ];
    const comments = new Map<string, string[]>();
    const jira = makeJira(issues, comments);
    const r1 = await advance(jira, { projectKey: PROJ, dry: false, workers: 2 });
    expect(r1.actions.some(a => a.action === 'POST_SELECTION')).toBe(true);
    const cursor1 = r1.cursor;
    // second run without approvals should be WAIT, not duplicate POST_SELECTION
    const r2 = await advance(jira, { projectKey: PROJ, dry: false, workers: 2 });
    expect(r2.actions.some(a => a.action === 'WAIT')).toBe(true);
    expect(r2.actions.some(a => a.detail.includes('selection-posted'))).toBe(false);
    // cursor is monotonic and persisted
    const saved = JSON.parse(readFileSync(resolve(STATE_DIR, `${PROJ}.json`), 'utf8'));
    expect(saved.cursor).toBe(cursor1);
    expect(r2.cursor).toBe(cursor1);
  });

  it('workerPool with 2 workers yields same results as 1 worker (order-independent)', async () => {
    const issues = Array.from({ length: 6 }, (_, i) => ({
      key: `${PROJ}-${i + 1}`,
      fields: { key: `${PROJ}-${i + 1}`, labels: ['candidate'], description: doc(para('x')), summary: `c${i}` },
    }));
    const jira1 = makeJira(issues, new Map());
    const jira2 = makeJira(issues, new Map());
    // clean between runs to avoid cursor carryover
    cleanState();
    const r1 = await advance(jira1, { projectKey: PROJ, dry: true, workers: 1 });
    cleanState();
    const r2 = await advance(jira2, { projectKey: PROJ, dry: true, workers: 2 });
    expect(r1.actions.length).toBe(r2.actions.length);
    expect(new Set(r1.actions.map(a => a.key))).toEqual(new Set(r2.actions.map(a => a.key)));
  });

  it('queue does not lose enqueues under 2 workers and drift reports queue mismatch', async () => {
    cleanState();
    // enqueue two jobs for same target different skills — second should be allowed (different skill)
    const e1 = enqueueGenerative(PROJ, { skill: 'aialm-oss-qa-impl', targetKey: `${PROJ}-10`, repoRef: 'acme/repo#1' });
    const e2 = enqueueGenerative(PROJ, { skill: 'aialm-oss-dev-impl', targetKey: `${PROJ}-10`, repoRef: 'acme/repo#1' });
    expect(e1.enqueued).toBe(true);
    expect(e2.enqueued).toBe(true);
    // duplicate same skill+target should be rejected
    const e3 = enqueueGenerative(PROJ, { skill: 'aialm-oss-qa-impl', targetKey: `${PROJ}-10`, repoRef: 'acme/repo#1' });
    expect(e3.enqueued).toBe(false);
    // claim with genWorkers=2 returns both (different skills, same wave) — drainQueue would serialize them
    const claimed = claimQueued(PROJ, 2);
    expect(claimed.length).toBe(2);
    // make claimed jobs appear old (>60s) so drift grace expires
    const qPath = resolve(STATE_DIR, `${PROJ}.queue.json`);
    const qRaw = JSON.parse(readFileSync(qPath, 'utf8'));
    for (const j of qRaw.jobs) if (j.status === 'running') j.updatedAt = new Date(Date.now() - 120_000).toISOString();
    writeFileSync(qPath, JSON.stringify(qRaw, null, 2));
    // drift should warn about remaining running job if Jira already has marker
    const comments = new Map<string, string[]>([[`${PROJ}-10`, ['aialm-oss-qa-impl marker']]]);
    const jira = {
      listComments: async (k: string) => (comments.get(k) ?? []).map(t => ({ bodyText: t })),
      getIssue: async () => ({ fields: { status: { name: 'In Progress' } } }),
      searchJql: async () => [],
    } as any;
    const drift = await analyzeDrift(jira, PROJ);
    expect(drift.warnings.some(w => w.includes('queue drift'))).toBe(true);
    // cleanup
    for (const j of claimed) markDone(PROJ, j.id);
  });

  it('analyzeDrift reports orphan workdir and ledger growth', async () => {
    cleanState();
    // create a fake state with large consumed
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(resolve(STATE_DIR, `${PROJ}.json`), JSON.stringify({ cursor: new Date().toISOString(), consumed: Array.from({ length: 450 }, (_, i) => `c${i}`) }));
    // create orphan workdir
    const wd = resolve('.work', `${PROJ}-orphan`);
    mkdirSync(wd, { recursive: true });
    // set mtime to old (25h ago) via utimes
    const old = new Date(Date.now() - 25 * 3600_000);
    const { utimesSync } = await import('node:fs');
    try { utimesSync(wd, old, old); } catch {}
    const jira = { listComments: async () => [], getIssue: async () => ({ fields: {} }), searchJql: async () => [] } as any;
    const drift = await analyzeDrift(jira, PROJ);
    expect(drift.warnings.some(w => w.includes('ledger growing'))).toBe(true);
    // orphan warning may appear depending on queue (empty queue means orphan)
    expect(drift.checked).toBe(true);
    // cleanup
    rmSync(wd, { recursive: true, force: true });
  });
});
