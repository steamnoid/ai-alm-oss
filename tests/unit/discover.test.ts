import { describe, expect, it, vi } from 'vitest';
import {
  buildCandidateDoc,
  externalMarker,
  extractExternalRef,
  externalRef,
  persistCandidates,
  summaryForCandidate,
} from '../../src/aialm/oss/discover/discover.ts';
import { adfToPlainText, type JiraClient } from '../../src/aialm/oss/alm/jira.ts';
import type { CandidateIssue } from '../../src/aialm/oss/shared/models.ts';

const candidate: CandidateIssue = {
  externalIssue: { repo: 'acme/widgets', number: 12, url: 'https://github.com/acme/widgets/issues/12' },
  issueType: 'bug',
  scope: 'login form',
  ambiguity: 'low',
  codeLocalizability: 'high',
  testability: 'high',
  dependencyRisk: 'low',
  expectedComplexity: 'S',
  conventionFit: 'good',
  implementationConfidence: '0.8',
  recommendation: 'READY',
  rationale: 'clear repro steps',
};

const full = {
  repo: 'acme/widgets',
  number: 12,
  url: candidate.externalIssue.url,
  title: 'Login broken',
  body: 'steps to reproduce...',
  candidate,
};

describe('external markers', () => {
  it('round-trips ref through marker', () => {
    const doc = buildCandidateDoc({ ...full, title: 'Login broken', body: 'steps...' });
    const text = adfToPlainText(doc);
    const ref = externalRef('acme/widgets', 12);
    expect(text).toContain(externalMarker(ref));
    expect(extractExternalRef(text)).toBe(ref);
  });

  it('builds stable summary', () => {
    expect(summaryForCandidate({ repo: 'acme/widgets', number: 12, title: 'Login broken' })).toBe(
      '[candidate] acme/widgets#12 — Login broken',
    );
  });
});

describe('persistCandidates', () => {
  function mockJira(existingDescriptions: string[]) {
    const created: any[] = [];
    const jira = {
      searchJql: vi.fn(async () =>
        existingDescriptions.map((description, i) => ({
          key: `X-${i}`,
          fields: { description },
        })),
      ),
      createIssue: vi.fn(async (body: any) => {
        created.push(body);
        return { key: `WIDG-10${created.length}` };
      }),
      addComment: vi.fn(async () => ({ id: 'c1' })),
      assign: vi.fn(async () => {}),
      getProject: vi.fn(async () => ({ lead: { accountId: 'LEAD1' } })),
    } as unknown as JiraClient & { createIssue: any };
    return { jira, created };
  }

  it('creates issues for new candidates with labels and description', async () => {
    const { jira, created } = mockJira([]);
    const r = await persistCandidates(jira, {
      projectKey: 'WIDG',
      repo: 'acme/widgets',
      candidates: [full],
    });
    expect(r.created.length).toBe(1);
    expect(r.skipped.length).toBe(0);
    const fields = created[0]!; // createIssue receives the `fields` payload directly
    expect(fields.labels).toEqual(['candidate', 'READY']);
    expect(fields.issuetype.id).toBe('10008');
    const text = adfToPlainText(fields.description);
    expect(text).toContain('recommendation: READY');
    expect(text).toContain(externalMarker('acme/widgets#12'));
  });

  it('skips refs already imported (idempotent)', async () => {
    const existingDoc = buildCandidateDoc({ ...full, title: 'old', body: null });
    const { jira, created } = mockJira([JSON.stringify(existingDoc)]);
    const r = await persistCandidates(jira, {
      projectKey: 'WIDG',
      repo: 'acme/widgets',
      candidates: [full],
    });
    expect(r.created.length).toBe(0);
    expect(r.skipped).toEqual([{ ref: 'acme/widgets#12', reason: 'already imported' }]);
    expect(created.length).toBe(0);
  });
});
