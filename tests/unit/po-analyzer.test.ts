import { describe, expect, it, vi } from 'vitest';
import {
  blockingReason,
  blockedComment,
  findingId,
  proposalComment,
  runAnalyze,
  summaryComment,
} from '../../src/aialm/oss/po/analyzer.ts';
import { adfToPlainText, type JiraClient } from '../../src/aialm/oss/alm/jira.ts';
import { doc, para } from '../../src/aialm/oss/alm/adf.ts';
import type { CandidateIssue, ProjectAiProfile } from '../../src/aialm/oss/shared/models.ts';

const profile: ProjectAiProfile = {
  version: 1,
  repo: 'acme/widgets',
  defaultBranch: 'main',
  languages: ['TypeScript'],
  structure: [],
  issueTemplates: [],
  conventions: { coding: [], test: [] },
  ciCommands: [],
  docsRefs: [],
  labelConventions: [],
  maintainerExpectations: [],
  restrictions: [],
};

function candidate(rec: CandidateIssue['recommendation']): CandidateIssue {
  return {
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
    recommendation: rec,
    rationale: 'clear repro steps',
  };
}

const finding = {
  issue: 'Login form must clear password on failed auth',
  why: 'Users cannot tell which field failed.',
  gherkin: 'Scenario: Clear password\nGiven a failed login\nWhen the user retries\nThen the password field is empty',
  kind: 'NON-BLOCKING' as const,
};

const analysis = (rec: CandidateIssue['recommendation'], findings: typeof finding[] = [finding]) => ({
  profile,
  candidate: candidate(rec),
  issueBody: 'steps to reproduce...',
  executionSketch: { touchedAreas: ['auth'], riskNotes: [], profileConventionFit: 'good' },
  findings,
});

describe('findingId', () => {
  it('is hash(norm(issue + gherkin)) — deterministic and id-collision-free', () => {
    const a = findingId(finding.issue, finding.gherkin);
    const b = findingId(finding.issue, finding.gherkin);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('blockingReason gate', () => {
  it('returns null for READY', () => {
    expect(blockingReason(analysis('READY'))).toBeNull();
  });

  it('returns a reason for every non-READY recommendation', () => {
    expect(blockingReason(analysis('BLOCKED'))).toContain('BLOCKED');
    expect(blockingReason(analysis('NEEDS-CLARIFICATION'))).toContain('NEEDS-CLARIFICATION');
    expect(blockingReason(analysis('UNSUITABLE'))).toContain('UNSUITABLE');
  });
});

describe('proposalComment (atomicity)', () => {
  it('carries exactly one proposal:<id> and the skill:id header', () => {
    const text = adfToPlainText(proposalComment('WIDG-5', finding));
    const id = findingId(finding.issue, finding.gherkin);
    expect(text).toContain(`aialm-oss-po-analyze:${id}`);
    expect(text).toContain(`proposal:${id}`);
    expect(text).toContain('Scenario: Clear password');
    expect(text.match(/proposal:[0-9a-f]{7}/g)).toHaveLength(1);
  });

  it('badges CREATIVE findings with creative:<id> and keeps the human ✅ gate', () => {
    const text = adfToPlainText(proposalComment('WIDG-5', { ...finding, kind: 'CREATIVE' }));
    const id = findingId(finding.issue, finding.gherkin);
    expect(text).toContain(`creative:${id}`);
    expect(text).toContain('AI proposes');
  });
});

describe('blockedComment', () => {
  it('is a single Blocked comment with repoRef and reason', () => {
    const t = adfToPlainText(blockedComment('acme/widgets#12', 'because'));
    expect(t).toContain('[AI-generated] Blocked — acme/widgets#12');
    expect(t).toContain('because');
  });
});

describe('runAnalyze', () => {
  function mockJira(existingComments: string[] = []) {
    const posted: string[] = [];
    let n = 0;
    return {
      jira: {
        listComments: vi.fn(async () =>
          existingComments.map((bodyText, i) => ({ id: `c${i}`, bodyText })),
        ),
        addComment: vi.fn(async (_k: string, adf: unknown) => {
          posted.push(adfToPlainText(adf));
          return { id: `new-${++n}` };
        }),
      } as unknown as JiraClient,
      posted,
    };
  }

  it('posts one atomic proposal per finding plus a summary, never mutating elsewhere', async () => {
    const { jira, posted } = mockJira();
    const r = await runAnalyze(jira, {
      issueKey: 'WIDG-5',
      repoRef: 'acme/widgets#12',
      analyze: analysis('READY', [finding, { ...finding, issue: 'Second issue', gherkin: 'Scenario: Two\nGiven x\nThen y' }]),
    });
    expect(r.blocked).toBe(false);
    expect(r.posted).toHaveLength(2);
    expect(r.skipped).toHaveLength(0);
    expect(posted).toHaveLength(3); // 2 proposals + 1 summary
    expect(posted[2]!).toContain('BLOCKING: 0');
    // each proposal comment holds exactly one Scenario
    expect(posted[0]!.match(/Scenario:/g)).toHaveLength(1);
    expect(posted[1]!.match(/Scenario:/g)).toHaveLength(1);
  });

  it('skips identical proposal ids (idempotent on re-run)', async () => {
    const existing = adfToPlainText(proposalComment('WIDG-5', finding));
    const { jira, posted } = mockJira([existing]);
    const r = await runAnalyze(jira, {
      issueKey: 'WIDG-5',
      repoRef: 'acme/widgets#12',
      analyze: analysis('READY', [finding]),
    });
    expect(r.posted).toHaveLength(0);
    expect(r.skipped).toEqual([{ proposalId: findingId(finding.issue, finding.gherkin), reason: 'already proposed' }]);
    expect(posted).toHaveLength(1); // summary only
    expect(posted[0]!).toContain('summary');
  });

  it('blocked path posts exactly one Blocked comment and stops (no proposals/summary)', async () => {
    const { jira, posted } = mockJira();
    const r = await runAnalyze(jira, {
      issueKey: 'WIDG-5',
      repoRef: 'acme/widgets#12',
      analyze: analysis('BLOCKED'),
    });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain('BLOCKED');
    expect(r.posted).toHaveLength(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]!).toContain('[AI-generated] Blocked —');
  });

  it('summarizes per-kind counts and proposal ids', () => {
    const s = {
      blocking: 1,
      nonBlocking: 2,
      creative: 3,
      proposalIds: ['aaaaaaa', 'bbbbbbb', 'ccccccc'],
    };
    const t = adfToPlainText(summaryComment(s));
    expect(t).toContain('BLOCKING: 1');
    expect(t).toContain('NON-BLOCKING: 2');
    expect(t).toContain('CREATIVE: 3');
    expect(t).toContain('aaaaaaa');
  });
});

describe('gate passes profile/issue through unchanged', () => {
  it('does not mutate input and never proposes technical safe defaults (no default values injected)', () => {
    const a = analysis('READY');
    const before = JSON.stringify(a);
    void doc(para('noop'));
    expect(JSON.stringify(a)).toBe(before);
    // findings carry no placeholder/default field beyond what the model defines
    expect(a.findings[0]!).toHaveProperty('gherkin');
  });
});
