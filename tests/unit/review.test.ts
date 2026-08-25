import { describe, expect, it, vi } from 'vitest';
import { analyzeReview, applyApprovedReview, reviewProposalId } from '../../src/aialm/oss/review/review.ts';
import { doc, para, codeBlock } from '../../src/aialm/oss/alm/adf.ts';
import type { JiraClient } from '../../src/aialm/oss/alm/jira.ts';

const SEC_FINDING = { title: 'Password stored with weak hash', body: 'Use bcrypt with cost >= 10.' };

function mockJira(opts: { desc?: unknown; comments?: { id: string; bodyText: string }[] } = {}) {
  const comments = new Map<string, { id: string; bodyText: string }[]>();
  const descs = new Map<string, unknown>();
  const assigns: { key: string; accountId: string }[] = [];
  let childLookup: Record<string, string[]> = {};
  const upd: any[] = [];
  const jira = {
    getIssue: vi.fn(async (k: string) => ({ fields: { description: descs.get(k) ?? opts.desc ?? doc(para('')) } })),
    listComments: vi.fn(async (k: string) => comments.get(k) ?? opts.comments ?? []),
    searchJql: vi.fn(async (jql: string) => { const p = /parent = ([A-Za-z0-9_-]+)/.exec(jql)?.[1]; if (p) return (childLookup[p] ?? []).map(k => ({ key: k })); return []; }),
    addComment: vi.fn(async (k: string, adf: unknown) => { comments.get(k) ?? comments.set(k, []); comments.get(k)!.push({ id: 'c' + comments.get(k)!.length, bodyText: JSON.stringify(adf) }); return { id: 'x' }; }),
    updateIssue: vi.fn(async (k: string, fields: any) => { upd.push({ k, fields }); descs.set(k, fields.description); }),
    assign: vi.fn(async (key: string, accountId: string) => assigns.push({ key, accountId })),
    unassign: vi.fn(async () => {}),
    getProject: vi.fn(async () => ({ lead: { accountId: 'L' } })),
  } as unknown as JiraClient;
  return { jira, comments, assigns, upd, setChildren: (c: Record<string, string[]>) => { childLookup = c; } };
}

describe('analyzeReview', () => {
  it('posts findings and assigns the role owner (sec)', async () => {
    const { jira, assigns, comments } = mockJira();
    const r = await analyzeReview(jira, { kind: 'sec', parentKey: 'WIDG-2', projectKey: 'WIDG', findingsByTarget: { 'WIDG-2': [SEC_FINDING] } });
    expect(r.targets[0]!.posted).toEqual([reviewProposalId('sec', SEC_FINDING)]);
    expect(comments.get('WIDG-2')!.some(c => c.bodyText.includes('Security Review'))).toBe(true);
  });
});

describe('applyApprovedReview', () => {
  it('merges approved sec findings into the target description, preserving outside content', async () => {
    const { jira, upd } = mockJira({
      desc: doc(para('existing body')),
      comments: [
        { id: 'ai', bodyText: `[AI-generated] Proposal — WIDG-2 — aialm-oss-sec-analyze:${reviewProposalId('sec', SEC_FINDING)}\nproposal:${reviewProposalId('sec', SEC_FINDING)}\nSecurity Review — ${SEC_FINDING.title}\nAI proposes` },
        { id: 'h', bodyText: `APPROVE:${reviewProposalId('sec', SEC_FINDING)}` },
      ],
    });
    const r = await applyApprovedReview(jira, { kind: 'sec', parentKey: 'WIDG-2', projectKey: 'WIDG' });
    expect(r.targets[0]!.status).toBe('APPLIED');
    expect(upd).toHaveLength(1);
    const desc = JSON.stringify(upd[0]!.fields.description);
    expect(desc).toContain('## Security Review');
    expect(desc).toContain('SEC hash:');
  });

  it('skips (idempotent) when already applied and clears assignee', async () => {
    const { jira, upd } = mockJira({
      desc: doc(para('existing body')),
      comments: [
        { id: 'ai', bodyText: `[AI-generated] Proposal — WIDG-2 — aialm-oss-sec-analyze:${reviewProposalId('sec', SEC_FINDING)}\nproposal:${reviewProposalId('sec', SEC_FINDING)}\nSecurity Review — ${SEC_FINDING.title}\nAI proposes` },
        { id: 'h', bodyText: `APPROVE:${reviewProposalId('sec', SEC_FINDING)}` },
      ],
    });
    const first = await applyApprovedReview(jira, { kind: 'sec', parentKey: 'WIDG-2', projectKey: 'WIDG' });
    expect(first.targets[0]!.status).toBe('APPLIED');
    // second run on the same jira (description now contains the block) → SKIPPED
    const second = await applyApprovedReview(jira, { kind: 'sec', parentKey: 'WIDG-2', projectKey: 'WIDG' });
    expect(second.targets[0]!.status).toBe('SKIPPED');
    expect(upd).toHaveLength(1);
  });
});

import { REVIEW } from '../../src/aialm/oss/review/review.ts';

describe('arch (kind=arch)', () => {
  it('posts architecture findings and merges approved into description', async () => {
    const { jira, comments, upd } = mockJira({ desc: doc(para('body')), comments: [] });
    const ARCH_FINDING = { title: 'Split auth into service layer', body: 'Introduce a service boundary.' };
    const a = await analyzeReview(jira, { kind: 'arch', parentKey: 'WIDG-2', projectKey: 'WIDG', findingsByTarget: { 'WIDG-2': [ARCH_FINDING] } });
    expect(a.targets[0]!.posted).toEqual([reviewProposalId('arch', ARCH_FINDING)]);

    // now apply (approved)
    const id = reviewProposalId('arch', ARCH_FINDING);
    comments.set('WIDG-2', [
      { id: 'ai', bodyText: `[AI-generated] Proposal — WIDG-2 — aialm-oss-arch-analyze:${id}\nproposal:${id}\nArchitecture Review — ${ARCH_FINDING.title}\nAI proposes` },
      { id: 'h', bodyText: `APPROVE:${id}` },
    ]);
    const r = await applyApprovedReview(jira, { kind: 'arch', parentKey: 'WIDG-2', projectKey: 'WIDG' });
    expect(r.targets[0]!.status).toBe('APPLIED');
    expect(JSON.stringify(upd[0]!.fields.description)).toContain('## Architecture Review');
    expect(JSON.stringify(upd[0]!.fields.description)).toContain('ARCH hash:');
  });
});
