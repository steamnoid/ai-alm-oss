import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enqueueGenerative,
  hasActiveJob,
  claimQueued,
  markDone,
  markFailed,
  setExternalRef,
  listRunningExternal,
  failUnrefRunning,
} from '../../src/aialm/oss/orchestrator/queue.ts';

// The queue module resolves state/<project>.json from cwd — chdir into a temp dir per test.
const tmp = mkdtempSync(join(tmpdir(), 'orch-queue-'));
process.chdir(tmp);

describe('generative queue', () => {
  beforeEach(() => { rmSync(join(tmp, 'state'), { recursive: true, force: true }); });

  it('enqueues a job and dedupes active ones', () => {
    expect(enqueueGenerative('WIDG', { skill: 'aialm-oss-po-analyze', targetKey: 'WIDG-1', repoRef: 'acme/widgets#1' }).enqueued).toBe(true);
    expect(hasActiveJob('WIDG', 'aialm-oss-po-analyze', 'WIDG-1')).toBe(true);
    const again = enqueueGenerative('WIDG', { skill: 'aialm-oss-po-analyze', targetKey: 'WIDG-1', repoRef: 'acme/widgets#1' });
    expect(again.enqueued).toBe(false);
  });

  it('claims queued jobs (marks running) and completes them', () => {
    enqueueGenerative('WIDG', { skill: 'aialm-oss-po-analyze', targetKey: 'WIDG-2', repoRef: 'r#2' });
    const claimed = claimQueued('WIDG', 5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.status).toBe('running');
    markDone('WIDG', claimed[0]!.id);
    expect(hasActiveJob('WIDG', 'aialm-oss-po-analyze', 'WIDG-2')).toBe(false);
  });

  it('markFailed records the error and releases the slot', () => {
    enqueueGenerative('WIDG', { skill: 'aialm-oss-sec-analyze', targetKey: 'WIDG-3', repoRef: 'r#3' });
    const [j] = claimQueued('WIDG', 5);
    markFailed('WIDG', j!.id, 'agent timeout');
    expect(hasActiveJob('WIDG', 'aialm-oss-sec-analyze', 'WIDG-3')).toBe(false);
  });

  it('records externalRef once and lists running dispatched jobs', () => {
    enqueueGenerative('WIDG', { skill: 'aialm-oss-dev-analyst', targetKey: 'WIDG-4', repoRef: 'r#4' });
    const [j] = claimQueued('WIDG', 5);
    setExternalRef('WIDG', j!.id, 'gen-widg-4-abc');
    setExternalRef('WIDG', j!.id, 'gen-overwrite-ignored'); // idempotent — first ref wins
    expect(listRunningExternal('WIDG').map(x => x.externalRef)).toEqual(['gen-widg-4-abc']);
    markDone('WIDG', j!.id);
    expect(listRunningExternal('WIDG')).toHaveLength(0);
  });

  it('fails undispatched running entries (crash between claim and dispatch)', () => {
    enqueueGenerative('WIDG', { skill: 'aialm-oss-po-analyze', targetKey: 'WIDG-5', repoRef: '' });
    const [a] = claimQueued('WIDG', 5);
    // simulate crash: running WITHOUT externalRef
    expect(failUnrefRunning('WIDG')).toBe(1);
    expect(hasActiveJob('WIDG', 'aialm-oss-po-analyze', 'WIDG-5')).toBe(false);
    // dispatched entries are untouched by recovery
    enqueueGenerative('WIDG', { skill: 'aialm-oss-po-analyze', targetKey: 'WIDG-6', repoRef: '' });
    const [b] = claimQueued('WIDG', 5);
    setExternalRef('WIDG', b!.id, 'gen-alive');
    expect(failUnrefRunning('WIDG')).toBe(0);
    expect(listRunningExternal('WIDG').map(x => x.id)).toContain(b!.id);
    void a;
  });
});
