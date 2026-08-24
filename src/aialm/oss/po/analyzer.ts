import type { JiraClient } from '../alm/jira.ts';
import { type AdfNode, type AdfRun, bullets, codeBlock, doc, para } from '../alm/adf.ts';
import { proposalHeader, proposalIdFor } from '../shared/identity.ts';
import type { CandidateIssue, ProjectAiProfile } from '../shared/models.ts';

const PO_SKILL = 'aialm-oss-po-analyze';

export type FindingKind = 'BLOCKING' | 'NON-BLOCKING' | 'CREATIVE';

/** One atomic finding: 1 proposal comment = 1 issue = 1 Gherkin Scenario. */
export interface ProposalFinding {
  issue: string; // raised issue, plain English
  why: string; // why it matters
  gherkin: string; // Scenario: Given/When/Then/And
  kind: FindingKind;
}

export interface ExecutionSketch {
  touchedAreas: string[];
  riskNotes: string[];
  profileConventionFit: string;
}

export interface AnalyzeInput {
  profile: ProjectAiProfile;
  candidate: CandidateIssue;
  issueBody: string | null;
  executionSketch: ExecutionSketch;
  findings: ProposalFinding[];
}

export interface AnalyzeSummary {
  blocking: number;
  nonBlocking: number;
  creative: number;
  proposalIds: string[];
}

export interface PostedComment {
  proposalId: string;
  commentId: string;
  kind: FindingKind;
}

export interface AnalyzeResult {
  blocked: boolean;
  blockedReason?: string;
  posted: PostedComment[];
  skipped: { proposalId: string; reason: string }[];
  summary: AnalyzeSummary;
}

/** proposalId = hash(norm(issue + gherkin)) — same canonical shape as V4. */
export function findingId(issue: string, gherkin: string): string {
  return proposalIdFor(`${issue}\n${gherkin}`);
}

/**
 * Gate: does the candidate still qualify for analysis?
 * Only READY candidates proceed. Blocked path → single Blocked comment, stop.
 */
export function blockingReason(input: AnalyzeInput): string | null {
  const rec = input.candidate.recommendation;
  if (rec === 'READY') return null;
  if (rec === 'BLOCKED') return 'Candidate is BLOCKED — execution would require credentials/private infra or exceeds the complexity/risk threshold.';
  if (rec === 'NEEDS-CLARIFICATION') return 'Candidate is NEEDS-CLARIFICATION — a maintainer must resolve missing information before analysis.';
  if (rec === 'UNSUITABLE') return 'Candidate is UNSUITABLE — out of scope per Profile restrictions.';
  return `Unknown candidate recommendation: ${rec}`;
}

/** Proposal comment for ONE finding (title header carries the skill:id marker). */
export function proposalComment(issueKey: string, finding: ProposalFinding): AdfNode {
  const id = findingId(finding.issue, finding.gherkin);
  const markerRuns: AdfRun[] = [{ t: `proposal:${id}`, c: true }];
  if (finding.kind === 'CREATIVE') markerRuns.push({ t: `creative:${id}`, c: true });
  return doc(
    para({ t: proposalHeader(issueKey, PO_SKILL, id), b: true }),
    para(...markerRuns),
    para({ t: 'Raised issue — ', b: true }, finding.issue),
    para({ t: 'Why it matters', b: true }),
    para(finding.why),
    para({ t: 'Proposed acceptance criteria', b: true }),
    codeBlock(finding.gherkin),
    para('AI proposes; a human approves via ✅ on the proposal.'),
  );
}

/** Single Blocked comment; the run stops after this. */
export function blockedComment(repoRef: string, reason: string): AdfNode {
  return doc(
    para({ t: `[AI-generated] Blocked — ${repoRef}`, b: true }),
    para(reason),
    para('Rerun once the recommendation is resolved back to READY.'),
  );
}

/** User-facing per-run summary: BLOCKING/NON-BLOCKING/CREATIVE counts + ids. */
export function summaryComment(summary: AnalyzeSummary): AdfNode {
  return doc(
    para({ t: '[AI-generated] aialm-oss-po-analyze summary', b: true }),
    bullets([
      [{ t: 'BLOCKING: ', b: true }, String(summary.blocking)],
      [{ t: 'NON-BLOCKING: ', b: true }, String(summary.nonBlocking)],
      [{ t: 'CREATIVE: ', b: true }, String(summary.creative)],
      [{ t: 'Proposals: ', b: true }, summary.proposalIds.join(', ') || '(none)'],
    ]),
  );
}

function summarize(findings: ProposalFinding[]): AnalyzeSummary {
  let blocking = 0;
  let nonBlocking = 0;
  let creative = 0;
  const ids: string[] = [];
  for (const f of findings) {
    ids.push(findingId(f.issue, f.gherkin));
    if (f.kind === 'BLOCKING') blocking++;
    else if (f.kind === 'NON-BLOCKING') nonBlocking++;
    else creative++;
  }
  return { blocking, nonBlocking, creative, proposalIds: ids };
}

/**
 * Orchestrate one po-analyze run on a candidate record (Jira issue).
 * - Gates on recommendation: non-READY → single Blocked comment, stop.
 * - Posts one proposal comment per finding, skipping already-proposed ids.
 * - Always finishes with a summary comment (unless blocked).
 */
export async function runAnalyze(
  jira: JiraClient,
  input: { issueKey: string; repoRef: string; analyze: AnalyzeInput },
): Promise<AnalyzeResult> {
  const { issueKey, repoRef, analyze } = input;

  const reason = blockingReason(analyze);
  if (reason) {
    await jira.addComment(issueKey, blockedComment(repoRef, reason));
    return {
      blocked: true,
      blockedReason: reason,
      posted: [],
      skipped: [],
      summary: summarize([]),
    };
  }

  const comments = await jira.listComments(issueKey);
  const existingIds = new Set<string>();
  for (const c of comments) {
    for (const m of c.bodyText.matchAll(/proposal:\s*([0-9a-f]{7})/g)) existingIds.add(m[1] as string);
  }

  const posted: PostedComment[] = [];
  const skipped: { proposalId: string; reason: string }[] = [];

  for (const f of analyze.findings) {
    const id = findingId(f.issue, f.gherkin);
    if (existingIds.has(id)) {
      skipped.push({ proposalId: id, reason: 'already proposed' });
      continue;
    }
    const created = await jira.addComment(issueKey, proposalComment(issueKey, f));
    posted.push({ proposalId: id, commentId: created.id, kind: f.kind });
    existingIds.add(id);
  }

  const summary = summarize(analyze.findings);
  await jira.addComment(issueKey, summaryComment(summary));
  return { blocked: false, posted, skipped, summary };
}
