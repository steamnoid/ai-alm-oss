import { describe, expect, it, vi } from 'vitest';
import {
  buildChildDescription,
  decompose,
  decomposeReportComment,
  filterExistingPayloads,
  findApprovedPackage,
  parsePackageComment,
  topoOrder,
  validatePackageForCreate,
} from '../../src/aialm/oss/po/decomposer.ts';
import { buildPackageComment, packageProposalId, type ChildSpec, type DecompositionPackage } from '../../src/aialm/oss/po/work-itemize.ts';
import { adfToPlainText, type JiraClient, type JiraComment } from '../../src/aialm/oss/alm/jira.ts';
import { doc, para } from '../../src/aialm/oss/alm/adf.ts';
import { externalMarker } from '../../src/aialm/oss/discover/discover.ts';

const AC1 = 'Scenario: Clear password\nGiven a failed login\nThen the field is empty';
const AC2 = 'Scenario: Highlight field\nGiven a failed login\nThen the field is underlined';

const child = (over: Partial<ChildSpec> = {}): ChildSpec => ({
  childKey: 'C1',
  title: 'Clear password field',
  goal: 'Reset the password input on failed auth.',
  scope: ['auth'],
  acceptanceCriteria: [AC1],
  sourceProductAcRefs: ['1111111'],
  dependencies: [],
  ...over,
});

const pkg = (children: ChildSpec[]): DecompositionPackage => ({ children });

function pkgProposal(p: DecompositionPackage, overText = '') {
  const id = packageProposalId(p);
  const commentAdf = buildPackageComment('WIDG-9', p, id);
  const bodyText = adfToPlainText(commentAdf) + overText;
  return { id, comment: { id: 'p1', bodyAdf: commentAdf, bodyText } };
}

function humanApprove(id: string): JiraComment {
  return { id: 'h1', bodyAdf: doc(para(`APPROVE:${id}`)), bodyText: `APPROVE:${id}` };
}

function parentAdf(acs: string[]) {
  return doc(para('## Acceptance Criteria'), ...acs.map(a => ({ type: 'codeBlock' as const, content: [{ type: 'text' as const, text: a }] })), para({ t: 'aialm-external: acme/widgets#12', c: true }));
}

describe('parsePackageComment', () => {
  it('round-trips a package built by prep-decompose', () => {
    const p = pkg([child(), child({ childKey: 'C2', title: 'Highlight', goal: 'Underline the failing field.', scope: ['ui'], acceptanceCriteria: [AC2], dependencies: ['C1'], sourceProductAcRefs: ['2222222'] })]);
    const { id, comment } = pkgProposal(p);
    const parsed = parsePackageComment(comment);
    expect(parsed?.packageId).toBe(id);
    expect(parsed?.pkg.children).toHaveLength(2);
    expect(parsed!.pkg.children[0]!.childKey).toBe('C1');
    expect(parsed!.pkg.children[0]!.goal).toBe('Reset the password input on failed auth.');
    expect(parsed!.pkg.children[1]!.dependencies).toEqual(['C1']);
    expect(parsed!.pkg.children[1]!.acceptanceCriteria).toEqual([AC2]);
  });

  it('returns null for comments without a package structure', () => {
    expect(parsePackageComment({ bodyAdf: doc(para('hello')), bodyText: 'hello' })).toBeNull();
  });
});

describe('findApprovedPackage', () => {
  it('returns only the latest human-approved package', () => {
    const p1 = pkg([child()]);
    const p2 = pkg([child({ childKey: 'C9', title: 'Newer', goal: 'g' })]);
    const { id: id1, comment: c1 } = pkgProposal(p1);
    const { id: id2, comment: c2 } = pkgProposal(p2);
    const comments = [c1, c2, humanApprove(id2)]; // only p2 approved
    const r = findApprovedPackage(comments);
    expect(r?.packageId).toBe(id2);
  });

  it('ignores packages without human approval', () => {
    const { id, comment } = pkgProposal(pkg([child()]));
    expect(findApprovedPackage([comment])).toBeNull();
  });
});

describe('filterExistingPayloads', () => {
  it('detects marker-based existing children', () => {
    const p = pkg([child()]);
    const id = packageProposalId(p);
    const existing = [
      { key: 'WIDG-100', summary: 'Clear password field', descriptionAdf: doc(para(`childKey:C1 packageProposal:${id} blah`)) },
    ];
    const r = filterExistingPayloads(p, id, existing);
    expect(r.alreadyCreated.has('C1')).toBe(true);
    expect(r.existingKey.get('C1')).toBe('WIDG-100');
  });

  it('falls back to normalized title only for markerless records', () => {
    const p = pkg([child()]);
    const id = packageProposalId(p);
    const markerless = [{ key: 'WIDG-101', summary: 'Clear password field', descriptionAdf: doc(para('no key marker')) }];
    const r = filterExistingPayloads(p, id, markerless);
    expect(r.alreadyCreated.has('C1')).toBe(true);
  });

  it('does not match children with a different package id', () => {
    const p = pkg([child()]);
    const existing = [{ key: 'WIDG-102', summary: 'Clear password field', descriptionAdf: doc(para('childKey:C1 packageProposal:fffffff')) }];
    const r = filterExistingPayloads(p, 'asdasda', existing);
    expect(r.alreadyCreated.has('C1')).toBe(false);
  });
});

describe('validatePackageForCreate', () => {
  it('accepts a valid acyclic package', () => {
    expect(validatePackageForCreate(pkg([child(), child({ childKey: 'C2', goal: 'g', dependencies: ['C1'] })]))).toEqual({ ok: true });
  });

  it('rejects duplicate childKeys', () => {
    expect(validatePackageForCreate(pkg([child(), child()]))).toMatchObject({ ok: false });
  });

  it('rejects cycles', () => {
    expect(validatePackageForCreate(pkg([child({ childKey: 'C1', dependencies: ['C2'] }), child({ childKey: 'C2', dependencies: ['C1'] })]))).toMatchObject({ ok: false });
  });
});

describe('topoOrder', () => {
  it('orders children so dependencies come first', () => {
    const ord = topoOrder(pkg([child({ childKey: 'C2', dependencies: ['C1'] }), child({ childKey: 'C1' })]).children);
    expect(ord!.map(c => c.childKey)).toEqual(['C1', 'C2']);
  });

  it('returns null on cycle', () => {
    expect(topoOrder(pkg([child({ childKey: 'A', dependencies: ['B'] }), child({ childKey: 'B', dependencies: ['A'] })]).children)).toBeNull();
  });
});

describe('buildChildDescription', () => {
  it('carries parent traceability, approved content, and stable key markers', () => {
    const text = adfToPlainText(buildChildDescription({
      parentKey: 'WIDG-9',
      packageId: 'abc1234',
      parentExternalRef: 'acme/widgets#12',
      child: child(),
    }));
    expect(text).toContain('**AI-generated from:** WIDG-9 (externalSource acme/widgets#12)');
    expect(text).toContain('Created by /aialm-oss-po-decompose');
    expect(text).toContain('## Goal');
    expect(text).toContain('Reset the password input on failed auth.');
    expect(text).toContain('## Acceptance Criteria');
    expect(text).toContain(AC1);
    expect(text).toContain('childKey:C1');
    expect(text).toContain('packageProposal:abc1234');
    expect(text).toContain(externalMarker('acme/widgets#12'));
  });
});

describe('decompose orchestrator', () => {
  function mockJira(opts: {
    comments?: JiraComment[];
    existingChildren?: { key: string; fields: { summary: string; description: unknown } }[];
    failOn?: string;
  } = {}) {
    const creates: any[] = [];
    const posted: string[] = [];
    const updates: any[] = [];
    let n = 0;
    return {
      jira: {
        getIssue: vi.fn(async () => ({ key: 'WIDG-9', fields: { description: parentAdf([AC1]), summary: 'Parent' } })),
        listComments: vi.fn(async () => opts.comments ?? []),
        searchJql: vi.fn(async () => opts.existingChildren ?? []),
        addComment: vi.fn(async (_k: string, adf: unknown) => { posted.push(adfToPlainText(adf)); return { id: `r${++n}` }; }),
        createIssue: vi.fn(async (fields: any) => {
          if (fields.summary === opts.failOn) throw new Error('fail');
          creates.push(fields);
          return { key: `WIDG-${100 + creates.length}` };
        }),
        updateIssue: vi.fn(async () => updates.push('x')),
        unassign: vi.fn(async () => {}),
      } as unknown as JiraClient,
      creates,
      posted,
      updates,
    };
  }

  it('BLOCKS when no approved package; parent untouched', async () => {
    const { jira, posted, creates, updates } = mockJira({ comments: [] });
    const r = await decompose(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r.status).toBe('BLOCKED');
    expect(r.reason).toContain('no approved');
    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(posted[0]!).toContain('NOT_ATTEMPTED');
  });

  it('creates children in dependency order with correct parent + taxonomy summary', async () => {
    const p = pkg([child({ childKey: 'C2', title: 'Highlight', goal: 'Underline field.', scope: ['ui'], dependencies: ['C1'] }), child({ childKey: 'C1' })]);
    const { id, comment } = pkgProposal(p);
    const { jira, creates, posted, updates } = mockJira({ comments: [comment, humanApprove(id)] });
    const r = await decompose(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r.status).toBe('CREATED');
    // dependency order: C1 first, then C2
    expect(creates.map(c => c.summary)).toEqual(['Clear password field', 'Highlight']);
    for (const c of creates) {
      expect(c.parent).toEqual({ key: 'WIDG-9' });
      const desc = adfToPlainText(c.description);
      expect(desc).toContain(externalMarker('acme/widgets#12'));
      expect(desc).toContain(`packageProposal:${id}`);
    }
    expect(updates).toHaveLength(0);
    const summary = posted.find(t => t.includes('Decomposition summary'))!;
    expect(summary).toContain('CREATED C1');
    expect(summary).toContain('CREATED C2');
  });

  it('skips already-created children on resume (idempotent, no duplicates)', async () => {
    const p = pkg([child()]);
    const { id, comment } = pkgProposal(p);
    const existingChild = { key: 'WIDG-100', fields: { summary: 'Clear password field', description: doc(para(`childKey:C1 packageProposal:${id}`)) } };
    const { jira, creates } = mockJira({ comments: [comment, humanApprove(id)], existingChildren: [existingChild] });
    const r = await decompose(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r.status).toBe('SKIPPED');
    expect(creates).toHaveLength(0);
    expect(r.outcomes[0]!.status).toBe('SKIPPED');
  });

  it('reports partial failure and marks dependents NOT_ATTEMPTED, resumable', async () => {
    const p = pkg([
      child({ childKey: 'C1' }),
      child({ childKey: 'C2', title: 'Dep of C1', goal: 'g', dependencies: ['C1'] }),
      child({ childKey: 'C3', title: 'Independent', goal: 'g2' }),
    ]);
    const { id, comment } = pkgProposal(p);
    const { jira, creates, posted } = mockJira({ comments: [comment, humanApprove(id)], failOn: 'Clear password field' }); // C1 fails
    const r = await decompose(jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(r.status).toBe('PARTIAL');
    const byKey = Object.fromEntries(r.outcomes.map(o => [o.childKey, o.status]));
    expect(byKey['C1']).toBe('FAILED');
    expect(byKey['C2']).toBe('NOT_ATTEMPTED'); // blocked by failed dependency
    expect(byKey['C3']).toBe('CREATED'); // still attempted
    const summary = posted.find(t => t.includes('Decomposition summary'))!;
    expect(summary).toContain('FAILED C1');
    expect(summary).toContain('NOT_ATTEMPTED C2');
    expect(summary).toContain('CREATED C3');
  });
});

describe('decomposeReportComment', () => {
  it('renders shared taxonomy', () => {
    const t = adfToPlainText(decomposeReportComment([{ target: 'C1', status: 'CREATED', detail: 'WIDG-100' }]));
    expect(t).toContain('Decomposition summary');
    expect(t).toContain('CREATED C1 — WIDG-100');
  });
});
