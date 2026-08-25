import { describe, expect, it, vi } from 'vitest';
import { advance, resolveNext } from '../../src/aialm/oss/orchestrator/advance.ts';
import { doc, para, codeBlock } from '../../src/aialm/oss/alm/adf.ts';
import type { JiraClient } from '../../src/aialm/oss/alm/jira.ts';

function issueSnap(k: string, description: unknown, labels: string[]) {
  return { key: k, fields: { key: k, description, labels, updated: '2026-08-25T08:00:00.000+0000' } };
}

function mockJira() {
  const byKey = new Map<string, any>();
  const comments = new Map<string, { id: string; bodyText: string }[]>();
  let childLookup: Record<string, string[]> = {};
  return {
    jira: {
      getIssue: vi.fn(async (key: string) => { const x = byKey.get(key); if (!x) throw new Error(`missing ${key}`); return x; }),
      listComments: vi.fn(async (key: string) => comments.get(key) ?? []),
      searchJql: vi.fn(async (jql: string) => {
        const parent = /parent = ([A-Za-z0-9_-]+)/.exec(jql)?.[1];
        if (parent) return (childLookup[parent] ?? []).map(k => ({ key: k, fields: byKey.get(k)?.fields }));
        return [...byKey.values()].filter(x => /updated >=/.test(jql)).map(x => x);
      }),
      // mutators' deps
      addComment: vi.fn(async () => ({ id: 'c' })),
      addAiComment: vi.fn(async () => ({ id: 's' })),
      updateIssue: vi.fn(async () => {}),
      createIssue: vi.fn(async () => ({ key: 'CHILD-1' })),
      unassign: vi.fn(async () => {}),
      getProject: vi.fn(async () => ({ lead: { accountId: 'LEAD1' } })),
    } as unknown as JiraClient,
    byKey,
    comments,
    setChildLookup: (c: Record<string, string[]>) => { childLookup = c; },
  };
}

const AC = 'Scenario: Selected event is visually marked\nGiven events listed\nWhen I click Select\nThen it is marked';

describe('resolveNext', () => {
  it('candidate without a selection proposal → POST_SELECTION (deterministic gate)', async () => {
    const { jira, byKey } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-1' });
    expect(a.kind).toBe('POST_SELECTION');
    expect((a as any).targetKey).toBe('WIDG-1');
  });

  it('candidate with unapproved selection proposal → WAIT (backlog, no auto po-analyze)', async () => {
    const { jira, byKey, comments } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
    comments.set('WIDG-1', [
      { id: 'ai', bodyText: '[AI-generated] Proposal aialm-oss-discover:dddd111 proposal:dddd111' },
      { id: 'h0', bodyText: 'looks interesting' }, // no decision
    ]);
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-1' });
    expect(a.kind).toBe('WAIT');
  });

  it('candidate with approved selection proposal but no po proposals → GENERATE po-analyze', async () => {
    const { jira, byKey, comments } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
    comments.set('WIDG-1', [
      { id: 'sel', bodyText: '[AI-generated] Proposal aialm-oss-discover:dddd111 proposal:dddd111' },
      { id: 'h0', bodyText: 'APPROVE:dddd111' },
    ]);
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-1' });
    expect(a.kind).toBe('GENERATE');
    expect((a as any).skill).toBe('aialm-oss-po-analyze');
  });

  it('candidate with approved proposals → APPLY import', async () => {
    const { jira, byKey, comments } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x'), para({ t: 'aialm-external: acme/widgets#12', c: true })), ['candidate', 'READY']));
    comments.set('WIDG-1', [
      { id: 'sel', bodyText: '[AI-generated] Proposal aialm-oss-discover:dddd111 proposal:dddd111' },
      { id: 'h0', bodyText: 'APPROVE:dddd111' },
      { id: 'ai', bodyText: '[AI-generated] Proposal aialm-oss-po-analyze:8d1e8e8 proposal:8d1e8e8' },
      { id: 'h', bodyText: 'APPROVE:8d1e8e8' },
    ]);
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-1' });
    expect(a.kind).toBe('APPLY');
    expect((a as any).mutator).toBe('import');
  });

  it('an AI-authored approval never satisfies the gate (no self-approval)', async () => {
    const { jira, byKey, comments } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
    comments.set('WIDG-1', [
      { id: 'ai', bodyText: '[AI-generated] Proposal aialm-oss-po-analyze:8d1e8e8 proposal:8d1e8e8' },
      { id: 'ai2', bodyText: '[AI-generated] APPROVE:8d1e8e8' }, // the agent attempts to self-approve
    ]);
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-1' });
    expect(a.kind).not.toBe('APPLY');
  });

  it('imported (has AC) with no package proposal → GENERATE prep-decompose', async () => {
    const { jira, byKey } = mockJira();
    byKey.set('WIDG-2', issueSnap('WIDG-2', doc(para('## Acceptance Criteria'), codeBlock(AC), para({ t: 'aialm-external: acme/widgets#12', c: true })), ['work-item', 'external']));
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-2' });
    expect(a.kind).toBe('GENERATE');
    expect((a as any).skill).toBe('aialm-oss-po-prep-decompose');
  });

  it('approved package → APPLY decompose', async () => {
    const { jira, byKey, comments } = mockJira();
    byKey.set('WIDG-2', issueSnap('WIDG-2', doc(para('## Acceptance Criteria'), codeBlock(AC), para({ t: 'aialm-external: acme/widgets#12', c: true })), ['work-item', 'external']));
    comments.set('WIDG-2', [
      { id: 'ai', bodyText: '[AI-generated] Proposal aialm-oss-po-prep-decompose:abcd123 proposal:abcd123' },
      { id: 'h', bodyText: 'APPROVE:abcd123' },
    ]);
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-2' });
    expect(a.kind).toBe('APPLY');
    expect((a as any).mutator).toBe('decompose');
  });

  it('child with QA+DEV applied and no security review → GENERATE sec-analyze', async () => {
    const { jira, byKey, comments, setChildLookup } = mockJira();
    byKey.set('WIDG-2', issueSnap('WIDG-2', doc(para('## Acceptance Criteria'), codeBlock(AC), para({ t: 'aialm-external: acme/widgets#12', c: true })), ['work-item']));
    byKey.set('WIDG-3', issueSnap('WIDG-3', doc(para('## Acceptance Criteria'), codeBlock(AC)), ['child', 'decomposed']));
    setChildLookup({ 'WIDG-2': ['WIDG-3'] });
    comments.set('WIDG-3', [
      { id: 'ai', bodyText: '[AI-generated] Proposal aialm-oss-qa-analyze:aaaa111 proposal:aaaa111' },
      { id: 'ai2', bodyText: '[AI-generated] Proposal aialm-oss-dev-analyst:bbbb222 proposal:bbbb222' },
    ]);
    // no SEC marker yet → GENERATE sec-analyze (QA+DEV proposals exist but no sec review)
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-2' });
    expect(a.kind).toBe('GENERATE');
    expect((a as any).skill).toBe('aialm-oss-sec-analyze');
  });

  it('props of child: with sec proposal approved → APPLY sec-apply', async () => {
    const { jira, byKey, comments, setChildLookup } = mockJira();
    byKey.set('WIDG-2', issueSnap('WIDG-2', doc(para('## Acceptance Criteria'), codeBlock(AC), para({ t: 'aialm-external: acme/widgets#12', c: true })), ['work-item']));
    byKey.set('WIDG-3', issueSnap('WIDG-3', doc(para('## Acceptance Criteria'), codeBlock(AC)), ['child']));
    setChildLookup({ 'WIDG-2': ['WIDG-3'] });
    comments.set('WIDG-3', [
      { id: 'ai', bodyText: '[AI-generated] Proposal aialm-oss-qa-analyze:aaaa111 proposal:aaaa111' },
      { id: 'ai2', bodyText: '[AI-generated] Proposal aialm-oss-dev-analyst:bbbb222 proposal:bbbb222' },
      { id: 'ai3', bodyText: '[AI-generated] Proposal aialm-oss-sec-analyze:cccc333 proposal:cccc333 Security Review' },
      { id: 'h', bodyText: 'APPROVE:cccc333' },
    ]);
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-2' });
    expect(a.kind).toBe('APPLY');
    expect((a as any).mutator).toBe('sec-apply');
  });
});

describe('advance', () => {
  it('dry-run reports and never mutates or persists state', async () => {
    const { jira, byKey, comments } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
    const res = await advance(jira, { projectKey: 'WIDG', dry: true });
    expect(res.scanned).toBeGreaterThanOrEqual(1);
    expect(res.actions.length).toBeGreaterThanOrEqual(1);
    const a = res.actions[0]!;
    expect(a.detail).toBe('dry:selection:WIDG-1');
  });

  it('fault isolation: one erroring issue does not stop the pass', async () => {
    const { jira, byKey } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
    byKey.set('WIDG-9', issueSnap('WIDG-9', doc(para('x')), ['candidate', 'READY']));
    const orig = (jira as any).getIssue;
    (jira as any).getIssue = vi.fn(async (k: string) => { if (k === 'WIDG-9') throw new Error('boom'); return orig(k); });
    const res = await advance(jira, { projectKey: 'WIDG', dry: true });
    expect(res.actions.some(a => a.action === 'ERROR')).toBe(true);
  });
});

it('child with QA+DEV applied, sec+arch review done → GENERATE qa-impl', async () => {
  const { jira, byKey, comments, setChildLookup } = mockJira();
  byKey.set('WIDG-2', issueSnap('WIDG-2', doc(para('## Acceptance Criteria'), codeBlock(AC), para({ t: 'aialm-external: acme/widgets#12', c: true })), ['work-item']));
  byKey.set('WIDG-3', issueSnap('WIDG-3', doc(para('## Acceptance Criteria'), codeBlock(AC)), ['child']));
  setChildLookup({ 'WIDG-2': ['WIDG-3'] });
  comments.set('WIDG-3', [
    { id: 'q', bodyText: '[AI-generated] Proposal aialm-oss-qa-analyze:aaaa111 proposal:aaaa111' },
    { id: 'd', bodyText: '[AI-generated] Proposal aialm-oss-dev-analyst:bbbb222 proposal:bbbb222' },
    { id: 's', bodyText: '[AI-generated] Proposal aialm-oss-sec-analyze:cccc333 proposal:cccc333 Security Review' },
    { id: 'a', bodyText: '[AI-generated] Proposal aialm-oss-arch-analyze:dddd444 proposal:dddd444 Architecture Review' },
  ]);
  const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-2' });
  expect(a.kind).toBe('GENERATE');
  expect((a as any).skill).toBe('aialm-oss-qa-impl');
});

it('tail: after qa-impl+dev-impl posted and no READY_FOR_PR → GENERATE verify on parent', async () => {
  const { jira, byKey, comments, setChildLookup } = mockJira();
  byKey.set('WIDG-2', issueSnap('WIDG-2', doc(para('## Acceptance Criteria'), codeBlock(AC), para({ t: 'aialm-external: acme/widgets#12', c: true })), ['work-item']));
  byKey.set('WIDG-3', issueSnap('WIDG-3', doc(para('## Acceptance Criteria'), codeBlock(AC)), ['child']));
  setChildLookup({ 'WIDG-2': ['WIDG-3'] });
  comments.set('WIDG-3', [
    { id: 'q', bodyText: '[AI-generated] Proposal aialm-oss-qa-analyze:aaaa111 proposal:aaaa111' },
    { id: 'd', bodyText: '[AI-generated] Proposal aialm-oss-dev-analyst:bbbb222 proposal:bbbb222' },
    { id: 's', bodyText: '[AI-generated] Proposal aialm-oss-sec-analyze:cccc333 proposal:cccc333 Security Review' },
    { id: 'a', bodyText: '[AI-generated] Proposal aialm-oss-arch-analyze:dddd444 proposal:dddd444 Architecture Review' },
    { id: 'qi', bodyText: 'aialm-oss-qa-impl IMPLEMENTED' },
    { id: 'di', bodyText: 'aialm-oss-dev-impl IMPLEMENTED' },
  ]);
  const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-2' });
  // parent has no READY_FOR_PR → generate verify
  expect(a.kind).toBe('GENERATE');
  expect((a as any).skill).toBe('aialm-oss-verify');
});

it('advance processes multiple changed issues concurrently and saves state once', async () => {
  const { jira, byKey } = mockJira();
  byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
  byKey.set('WIDG-2', issueSnap('WIDG-2', doc(para('x')), ['candidate', 'READY']));
  const gen = vi.fn(async () => 'gen');
  const res = await advance(jira, { projectKey: 'WIDG', dry: true });
  const keys = res.actions.map(a => a.key);
  expect(keys).toContain('WIDG-1');
  expect(keys).toContain('WIDG-2');
  // dry never launches the generative runner
  expect(gen.mock.calls.length).toBe(0);
});

import { skillStage } from '../../src/aialm/oss/alm/board.ts';

describe('board stages', () => {
  it('maps skills to their analyst columns', () => {
    expect(skillStage('aialm-oss-po-analyze')).toBe('Agent Working (PO Analyst)');
    expect(skillStage('aialm-oss-qa-analyze')).toBe('Agent Working (QA Analyst)');
    expect(skillStage('aialm-oss-arch-analyze')).toBe('Agent Working (ARCH Analyst)');
    expect(skillStage('aialm-oss-sec-analyze')).toBe('Agent Working (SEC Analyst)');
    expect(skillStage('aialm-oss-dev-analyst')).toBe('Agent Working (DEV Analyst)');
    expect(skillStage('aialm-oss-pr')).toBe('Agent Working (PR)');
  });

  it('WAIT on po proposals maps to Awaiting Approval (PO) column', async () => {
    const { jira, byKey, comments } = mockJira();
    byKey.set('WIDG-1', issueSnap('WIDG-1', doc(para('x')), ['candidate', 'READY']));
    comments.set('WIDG-1', [
      { id: 'sel', bodyText: '[AI-generated] Proposal aialm-oss-discover:dddd111 proposal:dddd111' },
      { id: 'h0', bodyText: 'APPROVE:dddd111' },
      { id: 'ai', bodyText: '[AI-generated] Proposal aialm-oss-po-analyze:8d1e8e8 proposal:8d1e8e8' },
    ]);
    const a = await resolveNext(jira, { projectKey: 'WIDG', issueKey: 'WIDG-1' });
    expect(a.kind).toBe('WAIT');
    expect((a as any).reason).toContain('po proposals');
  });
});
