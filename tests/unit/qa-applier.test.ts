import { describe, expect, it, vi } from 'vitest';
import {
  applyApprovedQa,
  buildGeneratedBlock,
  buildTargetMerge,
  collectQaProposals,
  generatedHash,
  parseQaProposalComment,
  qaApplySummaryComment,
} from '../../src/aialm/oss/qa/applier.ts';
import { qaProposalComment, qaProposalId, type QaProposal } from '../../src/aialm/oss/qa/analyzer.ts';
import { adfToPlainText, type JiraClient, type JiraComment } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

const AC = 'Scenario: Clear password\nGiven a failed login\nThen the field is empty';

const proposal = (over: Partial<QaProposal> = {}): QaProposal => ({
  sourceProductAC: AC,
  testObjective: 'Verify the password field is cleared.',
  kind: 'CORE',
  scenario: 'Scenario: Clear password field\nGiven a failed login\nThen the password field is empty',
  coverageHint: 'UI',
  rationale: 'Confirms the AC observable behavior.',
  ...over,
});

/** Build an AI QA proposal comment fixture (stamp + heading + footer). */
function qaComment(p: QaProposal): JiraComment {
  const adf = qaProposalComment('WIDG-9', p);
  return { id: 'p1', bodyAdf: adf, bodyText: adfToPlainText(adf) };
}

function humanApprove(id: string): JiraComment {
  return { id: 'h1', bodyAdf: doc(para(`APPROVE:${id}`)), bodyText: `APPROVE:${id}` };
}

function targetDescription(withAc = true) {
  const parts: unknown[] = [para('Manual note: please keep.')];
  if (withAc) {
    parts.push(para({ t: '## Acceptance Criteria', b: true }), codeBlock(AC));
  }
  return doc(...(parts as never[]));
}

describe('parseQaProposalComment', () => {
  it('qualifies a stamped QA proposal with matching footer id', () => {
    const p = proposal();
    const id = qaProposalId(p);
    const parsed = parseQaProposalComment(qaComment(p));
    expect(parsed?.id).toBe(id);
    expect(parsed?.proposal.kind).toBe('CORE');
    expect(parsed?.proposal.scenario).toBe(p.scenario);
    expect(parsed?.proposal.source).toContain('Clear password');
    expect(parsed?.proposal.coverageHint).toBe('UI');
  });

  it('defaults missing kind to CORE and objective to empty (lenient)', () => {
    const raw = doc(
      para({ t: `[AI-generated] Proposal — WIDG-9 — aialm-oss-qa-analyze:abc1234`, b: true }),
      para({ t: 'QA Scenario Proposal', b: true }),
      codeBlock('Scenario: X\nGiven y\nThen z'),
      para({ t: 'proposal:abc1234', c: true }),
    );
    const parsed = parseQaProposalComment({ bodyAdf: raw, bodyText: adfToPlainText(raw) });
    expect(parsed?.proposal.kind).toBe('CORE');
    expect(parsed?.proposal.objective).toBe('');
  });

  it('rejects comments without the QA stamp (Product AC / summary)', () => {
    // product AC (po-analyze-like) comment - no QA Scenario Proposal heading
    const poi = doc(para({ t: '[AI-generated] Proposal — WIDG-9 — aialm-oss-po-analyze:abc1234', b: true }), codeBlock('Scenario: Z'), para({ t: 'proposal:abc1234', c: true }));
    expect(parseQaProposalComment({ bodyAdf: poi, bodyText: adfToPlainText(poi) })).toBeNull();
    // summary comment mentions the heading but has no stamp/footer
    const sum = doc(para({ t: '[AI-generated] QA Scenario Proposal summary', b: true }), para('CREATED WIDG-9 — 1 proposal(s)'));
    expect(parseQaProposalComment({ bodyAdf: sum, bodyText: adfToPlainText(sum) })).toBeNull();
  });
});

describe('collectQaProposals', () => {
  it('selects only human-approved, dedupes by scenario, counts malformed', () => {
    const p = proposal();
    const id = qaProposalId(p);
    const dup = proposal({ scenario: p.scenario }); // same normalized scenario
    const comments = [qaComment(p), qaComment(dup), humanApprove(id), qaComment(proposal({ scenario: 'Scenario: Other\nGiven a\nThen b' }))];
    const r = collectQaProposals(comments);
    expect(r.proposals).toHaveLength(1); // only approved one; unapproved 'Other' excluded
    expect(r.malformed).toBe(0);
  });

  it('excludes unapproved QA proposals and counts malformed envelopes', () => {
    const p = proposal();
    const malformed = doc(para({ t: '[AI-generated] QA Scenario Proposal', b: true })); // heading but no stamp/footer/scenario
    const comments = [qaComment(p), humanApprove(qaProposalId(p)), { id: 'c2', bodyAdf: malformed, bodyText: adfToPlainText(malformed) }];
    const r = collectQaProposals(comments);
    expect(r.proposals).toHaveLength(1);
    expect(r.malformed).toBe(1);
  });
});

describe('generatedHash', () => {
  it('is deterministic and order-insensitive over scenarios', () => {
    const a = { id: 'a', source: AC, kind: 'CORE' as const, objective: 'o', scenario: 'Scenario: A\nGiven x\nThen y' };
    const b = { id: 'b', source: AC, kind: 'EDGE' as const, objective: 'o', scenario: 'Scenario: B\nGiven x\nThen y' };
    expect(generatedHash([a, b])).toBe(generatedHash([b, a]));
    expect(generatedHash([a])).not.toBe(generatedHash([b]));
  });
});

describe('buildTargetMerge', () => {
  it('appends the GENERATED block and preserves manual notes + AC outside it', () => {
    const p = proposal();
    const { adf, hash, changed } = buildTargetMerge(targetDescription(), [{ id: qaProposalId(p), source: AC, kind: 'CORE', objective: 'o', scenario: p.scenario, coverageHint: 'UI' }]);
    const text = adfToPlainText(adf);
    expect(changed).toBe(true);
    expect(text).toContain('Manual note: please keep.');
    expect(text).toContain('## Acceptance Criteria');
    expect(text).toContain(`<!-- GENERATED QA hash: ${hash} -->`);
    expect(text).toContain('# source: ' + AC);
    expect(text).toContain('# kind: CORE');
    expect(text).toContain(p.scenario);
    expect(text).toContain('<!-- END GENERATED QA -->');
  });

  it('is idempotent: identical hash → not changed, replaces old block (no duplicates)', () => {
    const sel = [{ id: 'a', source: AC, kind: 'CORE' as const, objective: 'o', scenario: 'Scenario: A\nGiven x\nThen y' }];
    const first = buildTargetMerge(targetDescription(), sel);
    expect(first.changed).toBe(true);
    const second = buildTargetMerge(first.adf, sel);
    expect(second.changed).toBe(false);
    const text = adfToPlainText(second.adf);
    expect(text.match(/GENERATED QA hash:/g)).toHaveLength(1);
    expect(text).toContain('Manual note: please keep.');
  });

  it('replaces an old block with different content while preserving surroundings', () => {
    const selA = [{ id: 'a', source: AC, kind: 'CORE' as const, objective: 'o', scenario: 'Scenario: A\nGiven x\nThen y' }];
    const selB = [{ id: 'b', source: AC, kind: 'EDGE' as const, objective: 'o', scenario: 'Scenario: B\nGiven z\nThen w' }];
    const first = buildTargetMerge(targetDescription(), selA);
    const second = buildTargetMerge(first.adf, selB);
    expect(second.changed).toBe(true);
    const text = adfToPlainText(second.adf);
    expect(text).toContain('Scenario: B');
    expect(text).not.toContain('Scenario: A');
    expect(text).toContain('Manual note: please keep.');
  });
});

describe('buildGeneratedBlock', () => {
  it('renders metadata lines + Gherkin for each proposal', () => {
    const text = adfToPlainText(buildGeneratedBlock('abc1234', [{ id: 'x', source: AC, kind: 'CREATIVE', objective: 'o', scenario: 'Scenario: Z\nGiven a\nThen b' }]));
    expect(text).toContain('<!-- GENERATED QA hash: abc1234 -->');
    expect(text).toContain('# source: ' + AC);
    expect(text).toContain('# kind: CREATIVE');
    expect(text).toContain('Scenario: Z');
    expect(text).toContain('<!-- END GENERATED QA -->');
  });
});

describe('applyApprovedQa', () => {
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

  it('exclusive mode: merges into each child independently, no cross-merge, no work items', async () => {
    const p = proposal();
    const id = qaProposalId(p);
    const comments = [qaComment(p), humanApprove(id)];
    const { jira, updates, creates } = mockJira({ children: ['WIDG-100', 'WIDG-101'], commentsByKey: { 'WIDG-100': comments, 'WIDG-101': [] } });
    const r = await applyApprovedQa(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.key).toBe('WIDG-100');
    expect(creates).toHaveLength(0);
    expect(r.targets.find(t => t.key === 'WIDG-101')!.status).toBe('SKIPPED');
  });

  it('single target when no children; idempotent second run applies 0 writes', async () => {
    const p = proposal();
    const id = qaProposalId(p);
    const comments = [qaComment(p), humanApprove(id)];
    const desc = targetDescription();
    const { jira, updates } = mockJira({ commentsByKey: { 'WIDG-9': comments }, descByKey: { 'WIDG-9': desc } });
    const r1 = await applyApprovedQa(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r1.targets[0]!.status).toBe('APPLIED');
    expect(updates).toHaveLength(1);
    // second run: same comments, description now has the block → same hash → 0 writes
    const { jira: jira2, updates: updates2 } = mockJira({ commentsByKey: { 'WIDG-9': comments }, descByKey: { 'WIDG-9': updates[0]!.fields.description } });
    const r2 = await applyApprovedQa(jira2, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r2.targets[0]!.status).toBe('SKIPPED');
    expect(updates2).toHaveLength(0);
  });

  it('summary reports APPLIED/SKIPPED and malformed via shared taxonomy', async () => {
    const p = proposal();
    const id = qaProposalId(p);
    const malformed = doc(para({ t: '[AI-generated] QA Scenario Proposal', b: true }));
    const { jira, posted } = mockJira({
      children: ['WIDG-100', 'WIDG-101'],
      commentsByKey: {
        'WIDG-100': [qaComment(p), humanApprove(id)],
        'WIDG-101': [{ id: 'm', bodyAdf: malformed, bodyText: adfToPlainText(malformed) }],
      },
    });
    const r = await applyApprovedQa(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r.malformed).toBe(1);
    const summary = posted.find(t => t.includes('QA GENERATED summary'))!;
    expect(summary).toContain('APPLIED WIDG-100');
    expect(summary).toContain('SKIPPED WIDG-101');
    expect(summary).toContain('Malformed: 1');
  });
});

describe('qaApplySummaryComment', () => {
  it('renders taxonomy rows', () => {
    const t = adfToPlainText(qaApplySummaryComment([{ target: 'WIDG-100', status: 'APPLIED', detail: 'abc1234' }], 0));
    expect(t).toContain('QA GENERATED summary');
    expect(t).toContain('APPLIED WIDG-100 — abc1234');
  });
});
