import { describe, expect, it, vi } from 'vitest';
import {
  analyzeQa,
  qaBlockedComment,
  qaProposalComment,
  qaProposalId,
  type QaProposal,
} from '../../src/aialm/oss/qa/analyzer.ts';
import { adfToPlainText, type JiraClient, type JiraComment } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

const AC = 'Scenario: Clear password\nGiven a failed login\nThen the field is empty';

const proposal = (over: Partial<QaProposal> = {}): QaProposal => ({
  sourceProductAC: AC,
  testObjective: 'Verify the password field is cleared on failed login.',
  kind: 'CORE',
  scenario: 'Scenario: Clear password field\nGiven a failed login\nThen the password field is empty',
  coverageHint: 'UI',
  rationale: 'Confirms the AC observable behavior.',
  ...over,
});

function acAdf() {
  return doc(para('## Acceptance Criteria'), codeBlock(AC), para({ t: 'aialm-external: acme/widgets#12', c: true }));
}

function mockJira(opts: { children?: string[]; acByKey?: Record<string, boolean>; existingByKey?: Record<string, string[]> } = {}) {
  const postedByKey = new Map<string, string[]>();
  const post = (key: string, text: string) => {
    const arr = postedByKey.get(key) ?? [];
    arr.push(text);
    postedByKey.set(key, arr);
  };
  let n = 0;
  return {
    jira: {
      searchJql: vi.fn(async () => (opts.children ?? []).map(k => ({ key: k }))),
      getIssue: vi.fn(async (key: string) => ({ key, fields: { description: opts.acByKey?.[key] === false ? doc(para('no AC')) : acAdf() } })),
      listComments: vi.fn(async (key: string) => ((opts.existingByKey?.[key] ?? []) as string[]).map((bodyText, i) => ({ id: `c${i}`, bodyText })) as JiraComment[]),
      addComment: vi.fn(async (key: string, adf: unknown) => { post(key, adfToPlainText(adf)); return { id: `r${++n}` }; }),
    } as unknown as JiraClient,
    postedByKey,
  };
}

describe('qaProposalId', () => {
  it('is hash(norm(sourceAC + objective + scenario)) and deterministic', () => {
    const p = proposal();
    expect(qaProposalId(p)).toBe(qaProposalId(p));
    expect(qaProposalId(p)).toMatch(/^[0-9a-f]{7}$/);
    expect(qaProposalId(proposal({ sourceProductAC: [AC] }))).toBe(qaProposalId(p));
  });

  it('differs across scenarios', () => {
    expect(qaProposalId(proposal())).not.toBe(qaProposalId(proposal({ scenario: 'Scenario: Other\nGiven x\nThen y' })));
  });
});

describe('qaProposalComment (selection contract)', () => {
  it('has the qa-analyze stamp, exact heading, fields, scenario, footer', () => {
    const p = proposal();
    const id = qaProposalId(p);
    const text = adfToPlainText(qaProposalComment('WIDG-9', p));
    expect(text).toContain(`[AI-generated] Proposal — WIDG-9 — aialm-oss-qa-analyze:${id}`);
    expect(text).toContain('QA Scenario Proposal');
    expect(text).toContain('source: Scenario: Clear password');
    expect(text).toContain('kind: CORE');
    expect(text).toContain('objective: Verify the password field is cleared on failed login.');
    expect(text).toContain('Why: Confirms the AC observable behavior.');
    expect(text).toContain('Coverage hint: UI');
    expect(text).toContain(p.scenario);
    expect(text).toContain(`proposal:${id}`);
  });
});

describe('qaBlockedComment', () => {
  it('targets the specific key', () => {
    const t = adfToPlainText(qaBlockedComment('WIDG-100', 'no AC'));
    expect(t).toContain('[AI-generated] Blocked — WIDG-100');
  });
});

describe('analyzeQa', () => {
  it('exclusive mode: analyzes each child and never the parent as one feature', async () => {
    const { jira, postedByKey } = mockJira({ children: ['WIDG-100', 'WIDG-101'] });
    const r = await analyzeQa(jira, {
      parentKey: 'WIDG-9',
      projectKey: 'WIDG',
      proposalsByTarget: {
        'WIDG-100': [proposal()],
        'WIDG-101': [proposal({ kind: 'EDGE', scenario: 'Scenario: Edge\nGiven x\nThen y' })],
      },
    });
    expect(r.targets.map(t => t.key)).toEqual(['WIDG-100', 'WIDG-101']);
    expect(postedByKey.has('WIDG-9')).toBe(true); // only summary on parent
    expect(postedByKey.get('WIDG-100')![0]).toContain('qa-analyze');
    // parent is never analyzed as a target
    expect(postedByKey.get('WIDG-9')![0]).toContain('summary');
    expect(r.counts).toMatchObject({ core: 1, edge: 1 });
  });

  it('single target when no children exist', async () => {
    const { jira } = mockJira({ children: [] });
    const r = await analyzeQa(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG', proposalsByTarget: { 'WIDG-9': [proposal()] } });
    expect(r.targets.map(t => t.key)).toEqual(['WIDG-9']);
    expect(r.counts.core).toBe(1);
  });

  it('BLOCKS only the target missing AC and continues the others', async () => {
    const { jira, postedByKey } = mockJira({ children: ['WIDG-100', 'WIDG-101'], acByKey: { 'WIDG-100': true, 'WIDG-101': false } });
    const r = await analyzeQa(jira, {
      parentKey: 'WIDG-9',
      projectKey: 'WIDG',
      proposalsByTarget: { 'WIDG-100': [proposal()], 'WIDG-101': [proposal()] },
    });
    const byKey = Object.fromEntries(r.targets.map(t => [t.key, t.blocked]));
    expect(byKey['WIDG-100']).toBe(false);
    expect(byKey['WIDG-101']).toBe(true);
    expect(postedByKey.get('WIDG-101')!.some(t => t.includes('Blocked'))).toBe(true);
    expect(r.counts.blocked).toBe(1);
    expect(r.rows.find(rr => rr.target === 'WIDG-101')!.status).toBe('BLOCKED');
  });

  it('is idempotent: skips identical proposal ids on re-run', async () => {
    const p = proposal();
    const id = qaProposalId(p);
    const existing = adfToPlainText(qaProposalComment('WIDG-9', p) as any);
    const { jira } = mockJira({ existingByKey: { 'WIDG-9': [existing] } });
    const r = await analyzeQa(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG', proposalsByTarget: { 'WIDG-9': [p] } });
    expect(r.targets[0]!.posted).toHaveLength(0);
    expect(r.targets[0]!.skipped).toEqual([id]);
  });

  it('never leaks implementation markers into the envelope (template is pure Gherkin)', () => {
    const text = adfToPlainText(qaProposalComment('WIDG-9', proposal()));
    expect(text).not.toMatch(/expect\(|SELECT |getBy|#id=|click\(/i);
  });
});
