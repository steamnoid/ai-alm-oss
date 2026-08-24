import { describe, expect, it, vi } from 'vitest';
import {
  analyzeDev,
  devBlockedComment,
  devProposalComment,
  devProposalId,
  devSummaryComment,
  extractGeneratedQa,
  resolveTargets,
  targetHasInputs,
  validateProfileFit,
  type DevProposal,
} from '../../src/aialm/oss/dev/analyst.ts';
import { adfToPlainText, type JiraClient, type JiraComment } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';
import type { ProjectAiProfile } from '../../src/aialm/oss/shared/models.ts';

const AC = 'Scenario: Clear password\nGiven a failed login\nThen the field is empty';
const QA_SC = 'Scenario: Clear password field\nGiven a failed login\nThen the password field is empty';

const profile: ProjectAiProfile = {
  version: 1,
  repo: 'acme/widgets',
  defaultBranch: 'main',
  languages: ['TypeScript'],
  structure: [],
  issueTemplates: [],
  conventions: { coding: [], test: ['data-testid'] },
  ciCommands: [],
  docsRefs: [],
  labelConventions: [],
  maintainerExpectations: [],
  restrictions: ['cypress'],
};

const proposal = (over: Partial<DevProposal> = {}): DevProposal => ({
  sourceProductAC: [AC],
  kind: 'LOCATOR',
  consumers: ['qa-impl', 'dev-impl'],
  title: 'Expose button test id',
  body: 'Add data-testid="login-submit" to the submit button.',
  ...over,
});

/** Description with Product AC + GENERATED QA block. */
function withInputs() {
  return doc(
    para({ t: '## Acceptance Criteria', b: true }),
    codeBlock(AC),
    para({ t: '<!-- GENERATED QA hash: abc1234 -->', c: true }),
    para({ t: '# source: ' + AC, c: true }),
    para({ t: '# kind: CORE', c: true }),
    codeBlock(QA_SC),
    para({ t: '<!-- END GENERATED QA -->', c: true }),
  );
}

function noAc() {
  return doc(para('<!-- GENERATED QA hash: abc1234 -->'), codeBlock(QA_SC), para('<!-- END GENERATED QA -->'));
}

describe('devProposalId', () => {
  it('is deterministic and differs by title/body', () => {
    expect(devProposalId(proposal())).toBe(devProposalId(proposal()));
    expect(devProposalId(proposal())).not.toBe(devProposalId(proposal({ title: 'Other', kind: 'API' })));
    expect(devProposalId(proposal())).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('devProposalComment', () => {
  it('has dev-analyst stamp, exact heading, fields, body, footer', () => {
    const p = proposal();
    const id = devProposalId(p);
    const text = adfToPlainText(devProposalComment('WIDG-9', p));
    expect(text).toContain(`[AI-generated] Proposal — WIDG-9 — aialm-oss-dev-analyst:${id}`);
    expect(text).toContain('Implementation Contract Proposal');
    expect(text).toContain(`kind: ${p.kind}`);
    expect(text).toContain(`sources: ${AC}`);
    expect(text).toContain('consumers: qa-impl, dev-impl');
    expect(text).toContain(`title: ${p.title}`);
    expect(text).toContain(p.body);
    expect(text).toContain(`proposal:${id}`);
  });
});

describe('devBlockedComment', () => {
  it('targets the specific key', () => {
    const t = adfToPlainText(devBlockedComment('WIDG-100', 'missing Product AC'));
    expect(t).toContain('[AI-generated] Blocked — WIDG-100');
    expect(t).toContain('missing Product AC');
  });
});

describe('extractGeneratedQa / targetHasInputs', () => {
  it('extracts GENERATED scenarios', () => {
    expect(extractGeneratedQa(withInputs())).toEqual([QA_SC]);
    expect(extractGeneratedQa(doc(para('no block')))).toEqual([]);
  });

  it('gates on AC AND GENERATED', () => {
    expect(targetHasInputs(withInputs())).toEqual({ ac: true, generated: true });
    expect(targetHasInputs(noAc())).toEqual({ ac: false, generated: true });
    expect(targetHasInputs(doc(para('## Acceptance Criteria'), codeBlock(AC)))).toEqual({ ac: true, generated: false });
  });
});

describe('resolveTargets', () => {
  it('filters legacy QA-prefixed titles and sorts by identifier', () => {
    const r = resolveTargets([
      { key: 'WIDG-102', summary: 'Child B' },
      { key: 'WIDG-100', summary: 'Child A' },
      { key: 'WIDG-101', summary: 'QA legacy' },
    ], 'WIDG-9');
    expect(r.mode).toBe('children');
    expect(r.targets).toEqual(['WIDG-100', 'WIDG-102']);
  });

  it('falls back to single target when no qualifying children remain', () => {
    const r = resolveTargets([{ key: 'WIDG-100', summary: 'QA legacy' }], 'WIDG-9');
    expect(r.mode).toBe('single');
    expect(r.targets).toEqual(['WIDG-9']);
  });
});

describe('validateProfileFit', () => {
  it('rejects seams contradicting Profile restrictions', () => {
    const bad = proposal({ title: 'Add a cypress test', body: 'use cypress framework' });
    const good = proposal();
    const r = validateProfileFit([bad, good], profile);
    expect(r.passed).toHaveLength(1);
    expect(r.passed[0]!.title).toBe(good.title);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toContain('cypress');
  });
});

describe('analyzeDev orchestrator', () => {
  function mockJira(opts: { children?: { key: string; summary: string }[]; descByKey?: Record<string, unknown>; existingByKey?: Record<string, string[]>; failOn?: string } = {}) {
    const creates: any[] = [];
    const postedByKey = new Map<string, string[]>();
    const post = (key: string, t: string) => { const a = postedByKey.get(key) ?? []; a.push(t); postedByKey.set(key, a); };
    let n = 0;
    return {
      jira: {
        searchJql: vi.fn(async () => (opts.children ?? []).map(c => ({ key: c.key, fields: { summary: c.summary } }))),
        getIssue: vi.fn(async (key: string) => ({ key, fields: { description: opts.descByKey?.[key] ?? withInputs() } })),
        listComments: vi.fn(async (key: string) => ((opts.existingByKey?.[key] ?? []) as string[]).map((bodyText, i) => ({ id: `c${i}`, bodyText })) as JiraComment[]),
        addComment: vi.fn(async (key: string, adf: unknown) => { post(key, adfToPlainText(adf)); return { id: `r${++n}` }; }),
        createIssue: vi.fn(async () => { creates.push('x'); return { key: 'WIDG-900' }; }),
      } as unknown as JiraClient,
      postedByKey,
      creates,
    };
  }

  it('exclusive mode: analyzes each qualifying child, blocks a target missing AC, continues others', async () => {
    const { jira, postedByKey, creates } = mockJira({
      children: [{ key: 'WIDG-100', summary: 'Child A' }, { key: 'WIDG-101', summary: 'Child B' }],
      descByKey: { 'WIDG-100': withInputs(), 'WIDG-101': noAc() },
    });
    const r = await analyzeDev(jira, {
      parentKey: 'WIDG-9',
      projectKey: 'WIDG',
      profile,
      proposalsByTarget: { 'WIDG-100': [proposal()], 'WIDG-101': [proposal()] },
    });
    const byKey = Object.fromEntries(r.targets.map(t => [t.key, t.blocked]));
    expect(byKey['WIDG-100']).toBe(false);
    expect(byKey['WIDG-101']).toBe(true);
    expect(postedByKey.get('WIDG-100')!.some(t => t.includes('dev-analyst:'))).toBe(true);
    expect(postedByKey.get('WIDG-101')!.some(t => t.includes('Blocked'))).toBe(true);
    expect(creates).toHaveLength(0); // no work items created
    expect(r.rows.find(rr => rr.target === 'WIDG-101')!.status).toBe('BLOCKED');
  });

  it('Posts proposals and is idempotent on re-run (skips identical ids)', async () => {
    const p = proposal();
    const id = devProposalId(p);
    const { jira, postedByKey } = mockJira({
      children: [{ key: 'WIDG-100', summary: 'Child A' }],
    });
    const r1 = await analyzeDev(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG', profile, proposalsByTarget: { 'WIDG-100': [p] } });
    expect(r1.targets[0]!.posted).toEqual([id]);
    // re-run with the proposal already present
    const existing = adfToPlainText(devProposalComment('WIDG-100', p) as any);
    const { jira: jira2 } = mockJira({ children: [{ key: 'WIDG-100', summary: 'Child A' }], existingByKey: { 'WIDG-100': [existing] } });
    const r2 = await analyzeDev(jira2, { parentKey: 'WIDG-9', projectKey: 'WIDG', profile, proposalsByTarget: { 'WIDG-100': [p] } });
    expect(r2.targets[0]!.posted).toHaveLength(0);
  });

  it('rejects Profile-contradicting seams (not posted) and reports them', async () => {
    const bad = proposal({ title: 'Add a cypress test', body: 'use cypress framework' });
    const { jira, postedByKey } = mockJira({ children: [{ key: 'WIDG-100', summary: 'Child A' }] });
    const r = await analyzeDev(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG', profile, proposalsByTarget: { 'WIDG-100': [bad] } });
    expect(r.targets[0]!.rejected).toHaveLength(1);
    expect(postedByKey.get('WIDG-100')?.some(t => t.includes('dev-analyst:'))).toBeFalsy();
    const summary = [...(postedByKey.get('WIDG-9') ?? [])].find(t => t.includes('Implementation Contract summary'))!;
    expect(summary).toContain('Rejected (Profile-contradicting): 1');
  });
});

describe('devSummaryComment', () => {
  it('renders taxonomy and rejection count', () => {
    const t = adfToPlainText(devSummaryComment([{ target: 'WIDG-100', status: 'CREATED', detail: '1 proposal(s)' }], 2));
    expect(t).toContain('Implementation Contract summary');
    expect(t).toContain('CREATED WIDG-100 — 1 proposal(s)');
    expect(t).toContain('Rejected (Profile-contradicting): 2');
  });
});
