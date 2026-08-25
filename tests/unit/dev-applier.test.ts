import { describe, expect, it, vi } from 'vitest';
import {
  applyApprovedDev,
  buildContractBlock,
  buildTargetMerge,
  collectDevProposals,
  contractHash,
  devApplySummaryComment,
  parseDevProposalComment,
} from '../../src/aialm/oss/dev/applier.ts';
import { devProposalComment, devProposalId, type DevProposal } from '../../src/aialm/oss/dev/analyst.ts';
import { adfToPlainText, type JiraClient, type JiraComment } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

const AC = 'Scenario: Clear password\nGiven a failed login\nThen the field is empty';

const proposal = (over: Partial<DevProposal> = {}): DevProposal => ({
  sourceProductAC: [AC],
  kind: 'LOCATOR',
  consumers: ['qa-impl', 'dev-impl'],
  title: 'Expose submit test id',
  body: 'Add data-testid="login-submit" to the submit button.',
  ...over,
});

function devComment(p: DevProposal): JiraComment {
  const adf = devProposalComment('WIDG-9', p);
  return { id: 'p1', bodyAdf: adf, bodyText: adfToPlainText(adf) };
}

function humanApprove(id: string): JiraComment {
  return { id: 'h1', bodyAdf: doc(para(`APPROVE:${id}`)), bodyText: `APPROVE:${id}` };
}

function targetDescription() {
  return doc(
    para('Manual note: keep me.'),
    para({ t: '## Acceptance Criteria', b: true }),
    codeBlock(AC),
    para({ t: 'GENERATED QA hash: abc1234', c: true }),
    codeBlock('Scenario: Clear password field\nGiven a failed login\nThen the field is empty'),
    para({ t: 'END GENERATED QA', c: true }),
  );
}

describe('parseDevProposalComment', () => {
  it('qualifies a stamped dev proposal (heading + stamp + footer)', () => {
    const p = proposal();
    const id = devProposalId(p);
    const parsed = parseDevProposalComment(devComment(p));
    expect(parsed?.id).toBe(id);
    expect(parsed?.entry.kind).toBe('LOCATOR');
    expect(parsed?.entry.sources).toEqual([AC]);
    expect(parsed?.entry.consumers).toEqual(['qa-impl', 'dev-impl']);
    expect(parsed?.entry.body).toContain('data-testid="login-submit"');
  });

  it('rejects QA/AC and other envelope comments', () => {
    const poi = doc(para({ t: '[AI-generated] Proposal — WIDG-9 — aialm-oss-qa-analyze:abc1234', b: true }), codeBlock('Scenario: Z'), para({ t: 'proposal:abc1234', c: true }));
    expect(parseDevProposalComment({ bodyAdf: poi, bodyText: adfToPlainText(poi) })).toBeNull();
    const sum = doc(para({ t: '[AI-generated] Implementation Contract summary', b: true }), para('CREATED WIDG-9 — 1 proposal(s)'));
    expect(parseDevProposalComment({ bodyAdf: sum, bodyText: adfToPlainText(sum) })).toBeNull();
  });

  it('returns null when malformed (no title/body)', () => {
    const raw = doc(para({ t: '[AI-generated] Proposal — WIDG-9 — aialm-oss-dev-analyst:abc1234', b: true }), para({ t: 'Implementation Contract Proposal', b: true }), para({ t: 'proposal:abc1234', c: true }));
    expect(parseDevProposalComment({ bodyAdf: raw, bodyText: adfToPlainText(raw) })).toBeNull();
  });
});

describe('collectDevProposals', () => {
  it('selects only approved entries, dedupes by body, counts malformed', () => {
    const p = proposal();
    const id = devProposalId(p);
    const dup = proposal({ body: p.body });
    const malformed = doc(para({ t: '[AI-generated] Implementation Contract Proposal', b: true }));
    const comments = [devComment(p), devComment(dup), humanApprove(id), { id: 'm', bodyAdf: malformed, bodyText: adfToPlainText(malformed) }];
    const r = collectDevProposals(comments);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.id).toBe(id);
    expect(r.malformed).toBe(1);
  });

  it('excludes unapproved dev proposals', () => {
    const p = proposal();
    const comments = [devComment(p)]; // no human approval
    const r = collectDevProposals(comments);
    expect(r.proposals).toHaveLength(0);
  });
});

describe('contractHash', () => {
  it('is deterministic and order-insensitive', () => {
    const a = { id: 'a', kind: 'SEAM' as const, sources: [AC], consumers: ['qa-impl', 'dev-impl'], title: 't1', body: 'body one' };
    const b = { id: 'b', kind: 'API' as const, sources: [AC], consumers: ['qa-impl', 'dev-impl'], title: 't2', body: 'body two' };
    expect(contractHash([a, b])).toBe(contractHash([b, a]));
    expect(contractHash([a])).not.toBe(contractHash([b]));
  });
});

describe('buildContractBlock', () => {
  it('emits sanitizer-safe visible markers and entry metadata', () => {
    const text = adfToPlainText(buildContractBlock('abc1234', [{ id: 'x', kind: 'LOCATOR', sources: [AC], consumers: ['qa-impl', 'dev-impl'], body: 'body', title: 'Expose test id' }]));
    expect(text).toContain('GENERATED DEV hash: abc1234');
    expect(text).toContain('# kind: LOCATOR');
    expect(text).toContain('# source: ' + AC);
    expect(text).toContain('# consumers: qa-impl, dev-impl');
    expect(text).toContain('Expose test id');
    expect(text).toContain('END GENERATED DEV');
  });
});

describe('buildTargetMerge', () => {
  it('appends the contract section and preserves AC + GENERATED QA + manual notes', () => {
    const entries = [{ id: 'x', kind: 'LOCATOR' as const, sources: [AC], consumers: ['qa-impl', 'dev-impl'], body: 'body', title: 't' }];
    const { adf, hash, changed } = buildTargetMerge(targetDescription(), entries);
    const text = adfToPlainText(adf);
    expect(changed).toBe(true);
    expect(text).toContain('Manual note: keep me.');
    expect(text).toContain('## Acceptance Criteria');
    expect(text).toContain('Scenario: Clear password field');
    expect(text).toContain('## Implementation Contract');
    expect(text).toContain(`GENERATED DEV hash: ${hash}`);
    expect(text).toContain('END GENERATED DEV');
  });

  it('is idempotent (identical hash → changed=false) and replaces only the region', () => {
    const entries = [{ id: 'a', kind: 'LOCATOR' as const, sources: [AC], consumers: ['qa-impl', 'dev-impl'], body: 'body', title: 't' }];
    const first = buildTargetMerge(targetDescription(), entries);
    expect(first.changed).toBe(true);
    const second = buildTargetMerge(first.adf, entries);
    expect(second.changed).toBe(false);
    const text = adfToPlainText(second.adf);
    expect(text.match(/GENERATED DEV hash:/g)).toHaveLength(1);
    expect(text).toContain('Manual note: keep me.');
    expect(text).toContain('## Implementation Contract');
  });

  it('replaces an old block with different content while preserving surroundings', () => {
    const a = { id: 'a', kind: 'LOCATOR' as const, sources: [AC], consumers: ['qa-impl', 'dev-impl'], body: 'body A', title: 'tA' };
    const b = { id: 'b', kind: 'API' as const, sources: [AC], consumers: ['qa-impl', 'dev-impl'], body: 'body B', title: 'tB' };
    const first = buildTargetMerge(targetDescription(), [a]);
    const second = buildTargetMerge(first.adf, [b]);
    expect(second.changed).toBe(true);
    const text = adfToPlainText(second.adf);
    expect(text).toContain('body B');
    expect(text).not.toContain('body A');
    expect(text).toContain('Manual note: keep me.');
  });
});

describe('applyApprovedDev', () => {
  function mockJira(opts: { children?: string[]; commentsByKey?: Record<string, JiraComment[]>; descByKey?: Record<string, unknown>; failUpdate?: string } = {}) {
    const updates: { key: string; fields: any }[] = [];
    const creates: any[] = [];
    const posted: string[] = [];
    let n = 0;
    return {
      jira: {
        searchJql: vi.fn(async () => (opts.children ?? []).map(k => ({ key: k }))),
        getIssue: vi.fn(async (key: string) => ({ key, fields: { description: opts.descByKey?.[key] ?? targetDescription(), summary: key } })),
        listComments: vi.fn(async (key: string) => opts.commentsByKey?.[key] ?? []),
        updateIssue: vi.fn(async (key: string, fields: any) => { if (key === opts.failUpdate) throw new Error('lock'); updates.push({ key, fields }); }),
        unassign: vi.fn(async () => {}),
        createIssue: vi.fn(async () => { creates.push('x'); return { key: 'WIDG-900' }; }),
        addComment: vi.fn(async (_k: string, adf: unknown) => { posted.push(adfToPlainText(adf)); return { id: `r${++n}` }; }),
      } as unknown as JiraClient,
      updates,
      creates,
      posted,
    };
  }

  it('exclusive mode: merges into each child independently; no work items created', async () => {
    const p = proposal();
    const id = devProposalId(p);
    const comments = [devComment(p), humanApprove(id)];
    const { jira, updates, creates } = mockJira({ children: ['WIDG-100', 'WIDG-101'], commentsByKey: { 'WIDG-100': comments, 'WIDG-101': [] } });
    const r = await applyApprovedDev(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.key).toBe('WIDG-100');
    expect(creates).toHaveLength(0);
    expect(r.targets.find(t => t.key === 'WIDG-101')!.status).toBe('SKIPPED');
  });

  it('idempotent second run applies 0 writes when unchanged', async () => {
    const p = proposal();
    const id = devProposalId(p);
    const comments = [devComment(p), humanApprove(id)];
    const { jira, updates } = mockJira({ commentsByKey: { 'WIDG-9': comments } });
    const r1 = await applyApprovedDev(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r1.targets[0]!.status).toBe('APPLIED');
    const { jira: jira2, updates: updates2 } = mockJira({ commentsByKey: { 'WIDG-9': comments }, descByKey: { 'WIDG-9': updates[0]!.fields.description } });
    const r2 = await applyApprovedDev(jira2, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r2.targets[0]!.status).toBe('SKIPPED');
    expect(updates2).toHaveLength(0);
  });

  it('summary reports APPLIED/SKIPPED and malformed via shared taxonomy', async () => {
    const p = proposal();
    const id = devProposalId(p);
    const malformed = doc(para({ t: '[AI-generated] Implementation Contract Proposal', b: true }));
    const { jira, posted } = mockJira({
      children: ['WIDG-100', 'WIDG-101'],
      commentsByKey: {
        'WIDG-100': [devComment(p), humanApprove(id)],
        'WIDG-101': [{ id: 'm', bodyAdf: malformed, bodyText: adfToPlainText(malformed) }],
      },
    });
    const r = await applyApprovedDev(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r.malformed).toBe(1);
    const summary = posted.find(t => t.includes('Implementation Contract summary'))!;
    expect(summary).toContain('APPLIED WIDG-100');
    expect(summary).toContain('SKIPPED WIDG-101');
    expect(summary).toContain('Malformed: 1');
  });
});

describe('devApplySummaryComment', () => {
  it('renders taxonomy', () => {
    const t = adfToPlainText(devApplySummaryComment([{ target: 'WIDG-100', status: 'APPLIED', detail: 'abc1234' }], 0));
    expect(t).toContain('Implementation Contract summary');
    expect(t).toContain('APPLIED WIDG-100 — abc1234');
  });
});
