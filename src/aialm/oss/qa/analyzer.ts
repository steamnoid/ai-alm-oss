import type { JiraClient } from '../alm/jira.ts';
import { type AdfNode, bullets, codeBlock, doc, heading, para } from '../alm/adf.ts';
import { proposalHeader, proposalIdFor } from '../shared/identity.ts';
import { MARKERS } from '../shared/markers.ts';
import type { StatusRow } from '../shared/status.ts';
import { extractAc } from '../po/work-itemize.ts';

const QA_SKILL = 'aialm-oss-qa-analyze';

export type QaProposalKind = 'CORE' | 'EDGE' | 'CREATIVE';
export type CoverageHint = 'UI' | 'API' | 'DATA' | 'INTEGRATION' | 'E2E';

/** One behavioral QA scenario derived from approved Product AC. */
export interface QaProposal {
  sourceProductAC: string | string[];
  testObjective: string;
  kind: QaProposalKind;
  scenario: string; // one behavioral Gherkin Scenario
  coverageHint?: CoverageHint;
  rationale: string;
}

export interface QaTargetResult {
  key: string;
  blocked: boolean;
  reason?: string;
  posted: { proposalId: string; commentId: string }[];
  skipped: string[];
}

export interface AnalyzeQaResult {
  targets: QaTargetResult[];
  counts: { core: number; edge: number; creative: number; blocked: number };
  rows: StatusRow[];
}

const PROPOSAL_ID_RE = /proposal:\s*([0-9a-f]{7})/;

function sourceKey(s: string | string[]): string {
  return Array.isArray(s) ? s.join(' ') : s;
}

/** proposalId = hash(norm(sourceProductAC + objective + scenario)). */
export function qaProposalId(p: QaProposal): string {
  return proposalIdFor(`${sourceKey(p.sourceProductAC)}\n${p.testObjective}\n${p.scenario}`);
}

/** QA Proposal comment — selection contract envelope (heading + stamp + footer). */
export function qaProposalComment(issueKey: string, p: QaProposal): AdfNode {
  const id = qaProposalId(p);
  const children: AdfNode[] = [
    para({ t: proposalHeader(issueKey, QA_SKILL, id), b: true }),
    heading(3, MARKERS.QA_PROPOSAL_HEADING),
    para({ t: `source: ${sourceKey(p.sourceProductAC)}`, c: true }),
    para({ t: `kind: ${p.kind}`, c: true }),
    para({ t: `objective: ${p.testObjective}`, c: true }),
    para({ t: `Why: ${p.rationale}`, c: true }),
  ];
  if (p.coverageHint) children.push(para({ t: `Coverage hint: ${p.coverageHint}`, c: true }));
  children.push(codeBlock(p.scenario));
  children.push(para({ t: `proposal:${id}`, c: true }));
  return doc(...children);
}

/** Per-target blocker when the target lacks approved Product AC. */
export function qaBlockedComment(targetKey: string, reason: string): AdfNode {
  return doc(
    para({ t: `[AI-generated] Blocked — ${targetKey}`, b: true }),
    para(reason),
    para('Rerun once the target has approved Product AC.'),
  );
}

export function qaSummaryComment(rows: StatusRow[]): AdfNode {
  return doc(
    para({ t: '[AI-generated] QA Scenario Proposal summary', b: true }),
    bullets(rows.map(r => [{ t: `${r.status}`, c: true }, ` ${r.target}`, ...(r.detail ? [` — ${r.detail}`] : [])])),
  );
}

function childOrder(key: string): number {
  const n = parseInt(key.split('-')[1] ?? '0', 10);
  return Number.isNaN(n) ? 0 : n;
}

async function findChildren(jira: JiraClient, projectKey: string, parentKey: string): Promise<string[]> {
  const issues = await jira.searchJql(`project = ${projectKey} AND parent = ${parentKey}`, ['key']);
  return issues.map(i => i.key as string).sort((a, b) => childOrder(a) - childOrder(b));
}

async function targetHasAc(jira: JiraClient, key: string): Promise<boolean> {
  const issue = (await jira.getIssue(key, ['description'])) as { fields?: { description?: unknown } };
  return extractAc(issue.fields?.description ?? {}).length > 0;
}

/**
 * QA scenario proposer. Exclusive subticket mode: when functional children
 * exist, each child is analyzed independently (never the parent as one feature),
 * sorted by identifier. A target with no approved Product AC is BLOCKED and the
 * run continues to the remaining targets. Idempotent per proposalId.
 */
export async function analyzeQa(
  jira: JiraClient,
  input: {
    parentKey: string;
    projectKey: string;
    proposalsByTarget: Record<string, QaProposal[]>;
  },
): Promise<AnalyzeQaResult> {
  const { parentKey, projectKey, proposalsByTarget } = input;
  const children = await findChildren(jira, projectKey, parentKey);
  const targets = children.length ? children : [parentKey];

  const results: QaTargetResult[] = [];
  let core = 0;
  let edge = 0;
  let creative = 0;
  let blocked = 0;

  for (const targetKey of targets) {
    const hasAc = await targetHasAc(jira, targetKey);
    if (!hasAc) {
      blocked++;
      await jira.addComment(targetKey, qaBlockedComment(targetKey, 'no approved Product AC to derive QA scenarios from'));
      results.push({ key: targetKey, blocked: true, reason: 'missing approved Product AC', posted: [], skipped: [] });
      continue;
    }
    const proposals = proposalsByTarget[targetKey] ?? [];
    const comments = await jira.listComments(targetKey);
    const existingIds = new Set<string>();
    for (const c of comments) {
      const m = PROPOSAL_ID_RE.exec(c.bodyText);
      if (m) existingIds.add(m[1] as string);
    }
    const posted: { proposalId: string; commentId: string }[] = [];
    const skipped: string[] = [];
    for (const p of proposals) {
      const id = qaProposalId(p);
      if (existingIds.has(id)) { skipped.push(id); continue; }
      const created = await jira.addComment(targetKey, qaProposalComment(targetKey, p));
      posted.push({ proposalId: id, commentId: created.id });
      existingIds.add(id);
      if (p.kind === 'CORE') core++;
      else if (p.kind === 'EDGE') edge++;
      else creative++;
    }
    results.push({ key: targetKey, blocked: false, posted, skipped });
  }

  const rows: StatusRow[] = results.map(r => {
    const detail = r.blocked ? (r.reason ?? 'no approved AC') : r.posted.length ? `${r.posted.length} proposal(s)` : r.skipped.length ? 'already proposed' : 'none';
    const status = r.blocked ? 'BLOCKED' : r.posted.length ? 'CREATED' : r.skipped.length ? 'SKIPPED' : 'NOT_ATTEMPTED';
    return { target: r.key, status: status as StatusRow['status'], detail };
  });

  await jira.addComment(parentKey, qaSummaryComment(rows));
  return { targets: results, counts: { core, edge, creative, blocked }, rows };
}
