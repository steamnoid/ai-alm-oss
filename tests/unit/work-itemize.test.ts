import { describe, expect, it, vi } from 'vitest';
import {
  acRef,
  buildPackageComment,
  extractAc,
  extractAcFromText,
  packageProposalId,
  prepDecompose,
  validatePackage,
  workItemizationBlockedComment,
  type ChildSpec,
  type DecompositionPackage,
} from '../../src/aialm/oss/po/work-itemize.ts';
import { adfToPlainText, type JiraClient } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

const AC1 = 'Scenario: Clear password field\nGiven a failed login\nWhen retry\nThen field empty';
const AC2 = 'Scenario: Highlight failing field\nGiven a failed login\nWhen submit\nThen field is underlined';

const child = (over: Partial<ChildSpec> = {}): ChildSpec => ({
  childKey: 'C1',
  title: 'Clear password field',
  goal: 'Reset the password input on failed auth.',
  scope: ['auth'],
  acceptanceCriteria: [AC1],
  sourceProductAcRefs: [acRef(AC1)],
  dependencies: [],
  ...over,
});

const pkg = (children: ChildSpec[] = [child()]): DecompositionPackage => ({ children });

/** Parent issue description ADF with a `## Acceptance Criteria` block → codeBlocks. */
function parentAdf(acs: string[]) {
  return doc(
    para('Repro notes'),
    para({ t: '## Acceptance Criteria', b: true }),
    ...acs.map(codeBlock),
    para({ t: 'externalSource: github acme/widgets#12', c: true }),
  );
}

describe('extractAc', () => {
  it('collects Scenarios under the AC heading only', () => {
    const acs = extractAc(parentAdf([AC1, AC2]));
    expect(acs).toEqual([AC1, AC2]);
  });

  it('returns [] when there is no AC section', () => {
    expect(extractAc(doc(para('no ac here')))).toEqual([]);
  });

  it('extracts from plain text as a fallback', () => {
    const t = `## Acceptance Criteria\n${AC1}\n${AC2}\nexternalSource: github x`;
    const acs = extractAcFromText(t);
    expect(acs).toHaveLength(2);
  });
});

describe('packageProposalId', () => {
  it('is deterministic and order-insensitive on string arrays for the same payload', () => {
    const a = pkg([child({ scope: ['auth', 'ui'] })]);
    const b = pkg([child({ scope: ['auth', 'ui'] })]);
    expect(packageProposalId(a)).toBe(packageProposalId(b));
    expect(packageProposalId(a)).toMatch(/^[0-9a-f]{7}$/);
  });

  it('differs for different payloads', () => {
    expect(packageProposalId(pkg([child()]))).not.toBe(packageProposalId(pkg([child({ title: 'Other' })])));
  });
});

describe('validatePackage', () => {
  it('accepts a well-formed, fully-covering package', () => {
    const p = pkg([
      child({ childKey: 'C1', sourceProductAcRefs: [acRef(AC1)] }),
      child({ childKey: 'C2', goal: 'Highlight the failing field.', scope: ['ui'], sourceProductAcRefs: [acRef(AC2)] }),
    ]);
    expect(validatePackage(p, [AC1, AC2])).toEqual({ ok: true });
  });

  it('rejects missing required child fields', () => {
    expect(validatePackage(pkg([child({ scope: [] })]), [AC1])).toMatchObject({ ok: false });
  });

  it('rejects duplicate childKeys', () => {
    expect(validatePackage(pkg([child(), child()]), [AC1, AC2])).toMatchObject({ ok: false });
  });

  it('rejects cyclic dependencies', () => {
    const c1 = child({ childKey: 'C1', dependencies: ['C2'] });
    const c2 = child({ childKey: 'C2', dependencies: ['C1'] });
    expect(validatePackage(pkg([c1, c2]), [])).toMatchObject({ ok: false, reason: expect.stringContaining('cycle') });
  });

  it('reports omission (BLOCKED) when parent AC is not fully covered', () => {
    const r = validatePackage(pkg([child({ sourceProductAcRefs: [acRef(AC1)] })]), [AC1, AC2]);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('coverage incomplete') });
  });

  it('rejects references to unknown parent AC', () => {
    const r = validatePackage(pkg([child({ sourceProductAcRefs: ['deadbeef'] })]), [AC1]);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('unknown parent AC') });
  });
});

describe('buildPackageComment', () => {
  it('carries the prep-decompose:<packageId> marker and full child specs', () => {
    const id = packageProposalId(pkg([child()]));
    const text = adfToPlainText(buildPackageComment('WIDG-9', pkg([child()]), id));
    expect(text).toContain(`aialm-oss-po-prep-decompose:${id}`);
    expect(text).toContain(`proposal:${id}`);
    expect(text).toContain('child:C1');
    expect(text).toContain('Clear password field');
    expect(text).toContain('Goal: Reset the password input on failed auth.');
    expect(text).toContain('Scope: auth');
    expect(text).toContain('AI proposes');
  });
});

describe('workItemizationBlockedComment', () => {
  it('says Work Itemization — Blocked with the reason', () => {
    const t = adfToPlainText(workItemizationBlockedComment('cant split'));
    expect(t).toContain('Work Itemization — Blocked');
    expect(t).toContain('cant split');
  });
});

describe('prepDecompose orchestrator', () => {
  function mockJira(opts: { description?: unknown; existingComments?: string[]; createIssue?: any } = {}) {
    const posted: string[] = [];
    const comments = (opts.existingComments ?? []).map((bodyText, i) => ({ id: `c${i}`, bodyText }));
    return {
      jira: {
        getIssue: vi.fn(async () => ({ key: 'WIDG-9', fields: { description: opts.description ?? doc(para('')), summary: 'S' } })),
        listComments: vi.fn(async () => comments),
        addComment: vi.fn(async (_k: string, adf: unknown) => { posted.push(adfToPlainText(adf)); return { id: `r${posted.length}` }; }),
        createIssue: opts.createIssue ?? vi.fn(),
        searchJql: vi.fn(async () => []),
        getProject: vi.fn(async () => ({ lead: { accountId: 'LEAD1' } })),
        assign: vi.fn(async () => {}),
      } as unknown as JiraClient,
      posted,
    };
  }

  it('BLOCKS when parent has no AC section; no comment becomes a proposal', async () => {
    const { jira, posted } = mockJira({ description: doc(para('no AC')) });
    const r = await prepDecompose(jira, { workItemKey: 'WIDG-9', pkg: pkg() });
    expect(r.status).toBe('BLOCKED');
    expect(r.reason).toContain('no approved ## Acceptance Criteria');
    expect(posted).toHaveLength(1);
    expect(posted[0]!).toContain('Blocked');
  });

  it('BLOCKS on invalid package (incomplete coverage); no proposal posted', async () => {
    const { jira, posted } = mockJira({ description: parentAdf([AC1, AC2]) });
    const r = await prepDecompose(jira, { workItemKey: 'WIDG-9', pkg: pkg([child({ sourceProductAcRefs: [acRef(AC1)] })]) });
    expect(r.status).toBe('BLOCKED');
    expect(r.reason).toContain('coverage incomplete');
    expect(posted[0]!).not.toContain('aialm-oss-po-prep-decompose:');
    expect(posted[0]!).toContain('Blocked');
  });

  it('CREATES a single package proposal comment and never creates children', async () => {
    const capture = vi.fn();
    const { jira, posted } = mockJira({ description: parentAdf([AC1, AC2]), createIssue: capture });
    const r = await prepDecompose(jira, {
      workItemKey: 'WIDG-9',
      pkg: pkg([
        child({ childKey: 'C1', sourceProductAcRefs: [acRef(AC1)] }),
        child({ childKey: 'C2', goal: 'Highlight the failing field.', scope: ['ui'], sourceProductAcRefs: [acRef(AC2)] }),
      ]),
    });
    expect(r.status).toBe('CREATED');
    expect(r.packageId).toMatch(/^[0-9a-f]{7}$/);
    expect(posted).toHaveLength(1);
    expect(posted[0]!).toContain(`aialm-oss-po-prep-decompose:${r.packageId}`);
    expect(capture).not.toHaveBeenCalled(); // no children created
  });

  it('SKIPS the identical package on re-run (idempotent)', async () => {
    const pack = pkg([child()]);
    const id = packageProposalId(pack);
    const existing = adfToPlainText(buildPackageComment('WIDG-9', pack, id));
    const { jira, posted } = mockJira({ description: parentAdf([AC1]), existingComments: [existing] });
    const r = await prepDecompose(jira, { workItemKey: 'WIDG-9', pkg: pack });
    expect(r.status).toBe('SKIPPED');
    expect(posted).toHaveLength(0);
  });
});
