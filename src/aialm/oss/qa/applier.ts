import type { JiraClient, JiraComment } from '../alm/jira.ts';
import { type AdfNode, bullets, codeBlock, doc, para } from '../alm/adf.ts';
import { hasHumanApprovalFor, type ApprovalComment } from '../shared/approval.ts';
import { normalize, proposalIdFor } from '../shared/identity.ts';
import { MARKERS } from '../shared/markers.ts';
import type { ReportStatus, StatusRow } from '../shared/status.ts';

export type QaKind = 'CORE' | 'EDGE' | 'CREATIVE';

/** A human-approved QA proposal, parsed from a QA Scenario Proposal comment. */
export interface QaSelectedProposal {
  id: string;
  source: string; // source Product AC (from `source:`)
  kind: QaKind;
  objective: string;
  scenario: string; // Gherkin Scenario
  coverageHint?: string;
}

export interface QaCollectResult {
  proposals: QaSelectedProposal[];
  malformed: number;
}

export interface QaTargetApply {
  key: string;
  status: 'APPLIED' | 'SKIPPED' | 'BLOCKED';
  count: number;
}

export interface ApplyQaResult {
  targets: QaTargetApply[];
  malformed: number;
  rows: StatusRow[];
}

const QA_STAMP_RE = /aialm-oss-qa-analyze:\s*([0-9a-f]{7})/;
const FOOTER_RE = /proposal:\s*([0-9a-f]{7})/;
const HASH_RE = /GENERATED QA hash:\s*([0-9a-f]{7})/;

function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  const n = node as { text?: unknown; content?: unknown[] };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) out += n.content.map(nodeText).join('');
  return out;
}

function asContent(description: unknown): unknown[] {
  const c = (description as { content?: unknown[] })?.content;
  return Array.isArray(c) ? c : [];
}

/**
 * Parse a QA Scenario Proposal comment into a proposal, or null.
 * Qualifies only with heading `QA Scenario Proposal`, header stamp
 * `aialm-oss-qa-analyze:<id>` and footer `proposal:<id>` (same id).
 */
export function parseQaProposalComment(comment: { bodyAdf: unknown; bodyText: string }): { id: string; proposal: Omit<QaSelectedProposal, 'id'> } | null {
  if (!comment.bodyText.includes(MARKERS.QA_PROPOSAL_HEADING)) return null;
  const id = QA_STAMP_RE.exec(comment.bodyText)?.[1];
  const footer = FOOTER_RE.exec(comment.bodyText)?.[1];
  if (!id || footer !== id) return null;

  let source = '';
  let kind = '';
  let objective = '';
  let scenario = '';
  let coverageHint: string | undefined;
  const content = asContent(comment.bodyAdf);
  for (const node of content) {
    if ((node as { type?: string }).type === 'codeBlock') {
      scenario = nodeText(node).trim();
      continue;
    }
    const t = nodeText(node).trim();
    if (t.startsWith('source: ')) source = t.slice(8).trim();
    else if (t.startsWith('kind: ')) kind = t.slice(6).trim();
    else if (t.startsWith('objective: ')) objective = t.slice(11).trim();
    else if (t.startsWith('Coverage hint: ')) coverageHint = t.slice(15).trim();
  }
  if (!scenario) return null;
  const k: QaKind = kind === 'EDGE' || kind === 'CREATIVE' ? kind : 'CORE'; // lenient default
  return { id, proposal: { source: source || '', kind: k, objective: objective || '', scenario, coverageHint } };
}

/**
 * Select approved, well-formed QA proposals from a target's comments.
 * Ignores Product AC / Candidate Qualification / Import Report / Work Itemization
 * comments (those lack the QG QA stamp + heading). Dedupes by normalized scenario.
 */
export function collectQaProposals(comments: JiraComment[]): QaCollectResult {
  const human: ApprovalComment[] = comments
    .filter(c => !c.bodyText.includes('[AI-generated]'))
    .map(c => ({ id: c.id, body: c.bodyText }));

  const proposals: QaSelectedProposal[] = [];
  const seen = new Set<string>();
  let malformed = 0;

  for (const c of comments) {
    if (!c.bodyText.includes(MARKERS.QA_PROPOSAL_HEADING)) continue; // not QA-looking
    if (c.bodyText.includes('[AI-generated]') === false) continue; // only AI proposals, approval is separate
    const parsed = parseQaProposalComment(c);
    if (!parsed) {
      malformed++;
      continue;
    }
    if (!hasHumanApprovalFor(human, parsed.id)) continue;
    const key = normalize(parsed.proposal.scenario);
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({ id: parsed.id, ...parsed.proposal });
  }
  return { proposals, malformed };
}

/** Deterministic hash over the approved scenario set + sources (order-insensitive). */
export function generatedHash(proposals: QaSelectedProposal[]): string {
  const canonical = proposals
    .map(p => `${p.source}\n${p.kind}\n${p.scenario}`)
    .sort()
    .join('\n');
  return proposalIdFor(`GENERATED QA\n${canonical}`);
}

/** The canonical GENERATED block (<open> ... <close>). */
export function buildGeneratedBlock(hash: string, proposals: QaSelectedProposal[]): AdfNode[] {
  const block: AdfNode[] = [
    para({ t: `<!-- GENERATED QA hash: ${hash} -->`, c: true }),
  ];
  for (const p of proposals) {
    block.push(para({ t: `# source: ${p.source}`, c: true }));
    block.push(para({ t: `# kind: ${p.kind}`, c: true }));
    block.push(para({ t: `# objective: ${p.objective}`, c: true }));
    block.push(codeBlock(p.scenario));
  }
  block.push(para({ t: '<!-- END GENERATED QA -->', c: true }));
  return block;
}

function splitGenerated(content: unknown[]): { before: unknown[]; after: unknown[]; hash: string | null } {
  let start = -1;
  let end = -1;
  let hash: string | null = null;
  content.forEach((node, i) => {
    const t = nodeText(node);
    if (start < 0 && t.includes('GENERATED QA hash:')) start = i;
    if (t.includes('END GENERATED QA')) end = i;
    const m = HASH_RE.exec(t);
    if (m) hash = m[1] as string;
  });
  if (start < 0 || end < 0 || end < start) return { before: content, after: [], hash: null };
  return { before: content.slice(0, start), after: content.slice(end + 1), hash };
}

/**
 * Merge approved proposals into a target description as the canonical GENERATED
 * block. Preserves everything outside the block verbatim. Idempotent by hash.
 */
export function buildTargetMerge(
  description: unknown,
  proposals: QaSelectedProposal[],
): { adf: AdfNode; hash: string; changed: boolean } {
  const hash = generatedHash(proposals);
  const content = asContent(description);
  const { before, after, hash: existingHash } = splitGenerated(content);
  const changed = existingHash !== hash;
  return {
    adf: doc(...(before as AdfNode[]), ...buildGeneratedBlock(hash, proposals), ...(after as AdfNode[])),
    hash,
    changed,
  };
}

export function qaApplySummaryComment(rows: StatusRow[], malformed: number): AdfNode {
  return doc(
    para({ t: '[AI-generated] QA GENERATED summary', b: true }),
    bullets(rows.map(r => [{ t: `${r.status}`, c: true }, ` ${r.target}`, ...(r.detail ? [` — ${r.detail}`] : [])])),
    para({ t: `Malformed: ${malformed}`, c: true }),
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

/**
 * Batch approved QA proposals into each analyzed target's OWN description.
 * Exclusive subticket mode: never cross-merge across unrelated children.
 * Idempotent (identical hash → no write). Creates no work items.
 */
export async function applyApprovedQa(
  jira: JiraClient,
  input: { parentKey: string; projectKey: string },
): Promise<ApplyQaResult> {
  const children = await findChildren(jira, input.projectKey, input.parentKey);
  const targets = children.length ? children : [input.parentKey];

  const rows: StatusRow[] = [];
  const targetResults: QaTargetApply[] = [];
  let malformed = 0;

  for (const targetKey of targets) {
    const issue = (await jira.getIssue(targetKey, ['description'])) as { fields?: { description?: unknown } };
    const comments = await jira.listComments(targetKey);
    const { proposals, malformed: m } = collectQaProposals(comments);
    malformed += m;

    if (proposals.length === 0) {
      rows.push({ target: targetKey, status: 'SKIPPED', detail: 'no approved QA proposals', });
      targetResults.push({ key: targetKey, status: 'SKIPPED', count: 0 });
      continue;
    }

    const { adf, hash, changed } = buildTargetMerge(issue.fields?.description, proposals);
    if (!changed) {
      rows.push({ target: targetKey, status: 'SKIPPED', detail: 'already applied' });
      targetResults.push({ key: targetKey, status: 'SKIPPED', count: proposals.length });
      continue;
    }

    try {
      await jira.updateIssue(targetKey, { description: adf });
      rows.push({ target: targetKey, status: 'APPLIED', detail: hash });
      targetResults.push({ key: targetKey, status: 'APPLIED', count: proposals.length });
    } catch (e) {
      rows.push({ target: targetKey, status: 'BLOCKED', detail: (e as Error).message });
      targetResults.push({ key: targetKey, status: 'BLOCKED', count: proposals.length });
    }
  }

  await jira.addComment(input.parentKey, qaApplySummaryComment(rows, malformed));
  return { targets: targetResults, malformed, rows };
}
