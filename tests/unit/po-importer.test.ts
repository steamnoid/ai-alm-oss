import { describe, expect, it, vi } from 'vitest';
import {
  approvedProposals,
  extractProposalId,
  extractProposals,
  importReportComment,
  importWorkItem,
  workItemDescription,
} from '../../src/aialm/oss/po/importer.ts';
import { findingId, proposalComment } from '../../src/aialm/oss/po/analyzer.ts';
import { adfToPlainText, type JiraClient, type JiraComment } from '../../src/aialm/oss/alm/jira.ts';
import { doc, para } from '../../src/aialm/oss/alm/adf.ts';
import { externalMarker, externalRef } from '../../src/aialm/oss/discover/discover.ts';
import type { ExternalSource } from '../../src/aialm/oss/shared/models.ts';

const finding = {
  issue: 'Clear password field on failed auth',
  why: 'Users cannot tell which field failed.',
  gherkin: 'Scenario: Clear password field\nGiven a failed login\nWhen the user retries\nThen the password field is empty',
  kind: 'NON-BLOCKING' as const,
};
const pid = findingId(finding.issue, finding.gherkin);

const finding2 = {
  issue: 'Show which field failed',
  why: 'Poor feedback is unsafe.',
  gherkin: 'Scenario: Field failure feedback\nGiven a failed login\nWhen the user submits\nThen the failing field is highlighted',
  kind: 'BLOCKING' as const,
};
const pid2 = findingId(finding2.issue, finding2.gherkin);

const external: ExternalSource = {
  provider: 'github',
  repo: 'acme/widgets',
  issueNumber: 12,
  url: 'https://github.com/acme/widgets/issues/12',
  syncedAt: '2026-08-24T00:00:00.000Z',
};

const baseInput = {
  projectKey: 'WIDG',
  candidateKey: 'WIDG-5',
  external,
  title: 'Login broken',
  humanSummary: 'Repro in #12.',
};

type AnyFinding = { issue: string; why: string; gherkin: string; kind: 'BLOCKING' | 'NON-BLOCKING' | 'CREATIVE' };

function propComment(f: AnyFinding, id = 'c1'): JiraComment {
  const adf = proposalComment('WIDG-5', f);
  return { id, bodyAdf: adf, bodyText: adfToPlainText(adf) };
}

function humanApprove(id: string, text = `APPROVE:${id}`): JiraComment {
  return { id: 'h1', bodyAdf: doc(para(text)), bodyText: text };
}

function mockJira(opts: { comments?: JiraComment[]; existingImports?: { key: string; fields: { description: unknown } }[] } = {}) {
  const updateCalls: any[] = [];
  const reportTexts: string[] = [];
  const unassigned: string[] = [];
  let rn = 0;
  return {
    jira: {
      listComments: vi.fn(async () => opts.comments ?? []),
      addComment: vi.fn(async (_k: string, adf: unknown) => {
        reportTexts.push(adfToPlainText(adf));
        return { id: `r${++rn}` };
      }),
      getIssue: vi.fn(async (key: string) => ({
        key,
        fields: { description: doc(para('existing body')), labels: ['candidate', 'READY'] },
      })),
      updateIssue: vi.fn(async (key: string, fields: Record<string, unknown>) => {
        updateCalls.push({ key, fields });
      }),
      unassign: vi.fn(async (key: string) => {
        unassigned.push(key);
      }),
      searchJql: vi.fn(async () => opts.existingImports ?? []),
    } as unknown as JiraClient,
    updateCalls,
    reportTexts,
    unassigned,
  };
}

describe('extractProposalId', () => {
  it('reads id from header and footer marker', () => {
    expect(extractProposalId(`aialm-oss-po-analyze:${pid}`)).toBe(pid);
    expect(extractProposalId(`proposal:${pid}`)).toBe(pid);
    expect(extractProposalId('summary Proposals: ' + pid)).toBeNull();
  });
});

describe('extractProposals', () => {
  it('keeps only well-formed AI proposals carrying a Scenario', () => {
    const ones = extractProposals([propComment(finding), humanApprove(pid)]);
    expect(ones).toHaveLength(1);
    expect(ones[0]!.id).toBe(pid);
    expect(ones[0]!.gherkin).toContain('Scenario: Clear password field');
  });
});

describe('approvedProposals', () => {
  it('selects only human-approved proposals', () => {
    const comments = [propComment(finding), propComment(finding2, 'c2'), humanApprove(pid)];
    const approved = approvedProposals(comments);
    expect(approved.map(p => p.id)).toEqual([pid]);
  });

  it('excludes trash-rejected proposals (🗑️ wins over APPROVE)', () => {
    const comments = [propComment(finding), humanApprove(pid, `🗑️:${pid} APPROVE:${pid}`)];
    expect(approvedProposals(comments)).toHaveLength(0);
  });

  it('dedupes by normalized gherkin and orders by id', () => {
    const dupA = { ...finding, gherkin: finding.gherkin };
    const comments = [
      propComment(finding, 'c1'),
      propComment(dupA as any, 'c2'), // identical normalized gherkin
      humanApprove(pid),
    ];
    const approved = approvedProposals(comments);
    expect(approved).toHaveLength(1);
  });

  it('an AI-authored APPROVE comment is never counted (self-approval blocked)', () => {
    const aiApprove: JiraComment = {
      id: 'ai',
      bodyAdf: doc(para('[AI-generated] APPROVE:' + pid)),
      bodyText: '[AI-generated] APPROVE:' + pid,
    };
    const comments = [propComment(finding), aiApprove];
    expect(approvedProposals(comments)).toHaveLength(0);
  });
});

describe('workItemDescription', () => {
  it('carries approved AC only, externalSource traceability and the external marker', () => {
    const adf = workItemDescription(baseInput, [{ id: pid, gherkin: finding.gherkin, aiGenerated: true }]);
    const text = adfToPlainText(adf);
    expect(text).toContain('## Acceptance Criteria');
    expect(text).toContain(finding.gherkin);
    expect(text).toContain(`proposal:${pid}`);
    expect(text).toContain('externalSource: github acme/widgets#12');
    expect(text).toContain(externalMarker('acme/widgets#12'));
    // never includes the unapproved scenario
    expect(text).not.toContain(finding2.gherkin);
  });
});

describe('importReportComment', () => {
  it('renders the shared taxonomy rows', () => {
    const t = adfToPlainText(
      importReportComment([
        { target: 'acme/widgets#12', status: 'CREATED', detail: 'WIDG-100' },
      ]),
    );
    expect(t).toContain('Import Report');
    expect(t).toContain('CREATED acme/widgets#12 — WIDG-100');
  });
});

describe('importWorkItem — gate', () => {
  it('BLOCKED when no proposal is approved; never creates', async () => {
    const { jira, reportTexts } = mockJira({
      comments: [propComment(finding), humanApprove(pid + 'f'), humanApprove('0000000')], // no matching approval
    });
    const r = await importWorkItem(jira, baseInput);
    expect(r.status).toBe('BLOCKED');
    expect(r.approvedCount).toBe(0);
    // exactly one report comment posted
    expect(reportTexts).toHaveLength(1);
    expect(reportTexts[0]!).toContain('BLOCKED acme/widgets#12');
  });

  it('skips unapproved candidates entirely (no created item)', async () => {
    const { jira } = mockJira({ comments: [propComment(finding)] });
    await importWorkItem(jira, baseInput);
  });
});

describe('importWorkItem — dedupe & single-create', () => {
  it('SKIPPED when a work item already exists for the ref; no create', async () => {
    const { jira, reportTexts, unassigned } = mockJira({
      comments: [propComment(finding), humanApprove(pid)],
      existingImports: [
        { key: 'WIDG-100', fields: { description: workItemDescription(baseInput, [{ id: pid, gherkin: finding.gherkin, aiGenerated: true }]) } },
      ],
    });
    const r = await importWorkItem(jira, baseInput);
    expect(r.status).toBe('SKIPPED');
    expect(r.workItemKey).toBe('WIDG-100');
    expect(reportTexts[0]!).toContain('SKIPPED acme/widgets#12 — already imported as WIDG-100');
    expect(unassigned).toContain('WIDG-5');
  });

  it('CREATED by upgrading the candidate in place; no new ticket; assignee cleared', async () => {
    const comments = [propComment(finding), humanApprove(pid)];
    const { jira, updateCalls, reportTexts, unassigned } = mockJira({ comments });
    const r = await importWorkItem(jira, baseInput);
    expect(r.status).toBe('CREATED');
    expect(r.approvedCount).toBe(1);
    expect(r.workItemKey).toBe('WIDG-5');
    // one in-place update, never a createIssue
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.key).toBe('WIDG-5');
    const labels = updateCalls[0]!.fields.labels as string[];
    expect(labels).toEqual(['candidate', 'READY', 'work-item', 'external']);
    const desc = adfToPlainText(updateCalls[0]!.fields.description);
    expect(desc).toContain('## Acceptance Criteria');
    expect(desc).toContain(finding.gherkin);
    expect(desc).toContain('externalSource: github acme/widgets#12');
    expect(desc).toContain(externalMarker('acme/widgets#12'));
    // assignee-hygiene: nothing undecided → unassigned
    expect(unassigned).toContain('WIDG-5');
    // human summary preserved verbatim (existing description kept)
    expect(desc).toContain('existing body');
    expect(reportTexts[0]!).toContain('CREATED acme/widgets#12 — WIDG-5');
  });
});
