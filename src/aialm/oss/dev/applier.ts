import type { JiraClient, JiraComment } from '../alm/jira.ts';
import { type AdfNode, bullets, doc, para } from '../alm/adf.ts';
import { hasHumanApprovalFor, unassignIfAllDecided, type ApprovalComment } from '../shared/approval.ts';
import { normalize, proposalIdFor, isAiMarked} from '../shared/identity.ts';
import { MARKERS } from '../shared/markers.ts';
import type { StatusRow } from '../shared/status.ts';
import type { DevProposalKind } from './analyst.ts';

export interface DevContractEntry {
  id: string;
  kind: DevProposalKind;
  sources: string[];
  consumers: string[];
  title: string;
  body: string;
  profileRefs?: string[];
  qaRefs?: string[];
}

export interface DevContractResult {
  proposals: DevContractEntry[];
  malformed: number;
}

export interface DevTargetApply {
  key: string;
  status: 'APPLIED' | 'SKIPPED' | 'BLOCKED';
  count: number;
}

export interface ApplyDevResult {
  targets: DevTargetApply[];
  malformed: number;
  rows: StatusRow[];
}

const DEV_STAMP_RE = /aialm-oss-dev-analyst:\s*([0-9a-f]{7})/;
const FOOTER_RE = /proposal:\s*([0-9a-f]{7})/;
const HASH_RE = /GENERATED DEV hash:\s*([0-9a-f]{7})/;

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

function splitList(s: string): string[] {
  return s.split(/;|,\s*/).map(x => x.trim()).filter(Boolean);
}

function childOrder(key: string): number {
  const n = parseInt(key.split('-')[1] ?? '0', 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parse an Implementation Contract Proposal comment into a contract entry.
 * Qualifies only with heading `Implementation Contract Proposal`, header stamp
 * `aialm-oss-dev-analyst:<id>` and footer `proposal:<id>` (same id).
 */
export function parseDevProposalComment(comment: { bodyAdf: unknown; bodyText: string }): { id: string; entry: Omit<DevContractEntry, 'id'> } | null {
  if (!comment.bodyText.includes(MARKERS.DEV_PROPOSAL_HEADING)) return null;
  const id = DEV_STAMP_RE.exec(comment.bodyText)?.[1];
  const footer = FOOTER_RE.exec(comment.bodyText)?.[1];
  if (!id || footer !== id) return null;

  let kind = '';
  let sources = '';
  let consumers = '';
  let profileRefs = '';
  let qaRefs = '';
  let title = '';
  let body = '';
  let expectBody = false;

  for (const node of asContent(comment.bodyAdf)) {
    const t = nodeText(node).trim();
    if (t === 'Proposed contract body') { expectBody = true; continue; }
    if (t.startsWith('kind: ')) kind = t.slice(6).trim();
    else if (t.startsWith('sources: ')) sources = t.slice(9).trim();
    else if (t.startsWith('consumers: ')) consumers = t.slice(11).trim();
    else if (t.startsWith('profile refs: ')) profileRefs = t.slice(14).trim();
    else if (t.startsWith('qa refs: ')) qaRefs = t.slice(9).trim();
    else if (t.startsWith('title: ')) title = t.slice(7).trim();
    else if (expectBody && t) { body = t; expectBody = false; }
  }

  if (!title && !body) return null; // malformed
  const k: DevProposalKind = (['SEAM', 'LOCATOR', 'API', 'UI-STATE', 'DATA', 'OPEN'] as const).includes(kind as DevProposalKind) ? (kind as DevProposalKind) : 'OPEN';
  return {
    id,
    entry: {
      kind: k,
      sources: splitList(sources),
      consumers: consumers ? splitList(consumers) : ['qa-impl', 'dev-impl'],
      title,
      body,
      profileRefs: profileRefs ? splitList(profileRefs) : undefined,
      qaRefs: qaRefs ? splitList(qaRefs) : undefined,
    },
  };
}

/**
 * Select approved, well-formed Implementation Contract entries from a target's
 * comments. Ignores AC / QA / Candidate / Import / Itemization / summary
 * comments (no dev-analyst stamp + heading). Dedupes by body-hash.
 */
export function collectDevProposals(comments: JiraComment[]): DevContractResult {
  const human: ApprovalComment[] = comments
    .filter(c => !isAiMarked(c.bodyText))
    .map(c => ({ id: c.id, body: c.bodyText }));

  const proposals: DevContractEntry[] = [];
  const seen = new Set<string>();
  let malformed = 0;

  for (const c of comments) {
    if (!c.bodyText.includes(MARKERS.DEV_PROPOSAL_HEADING)) continue;
    if (!isAiMarked(c.bodyText)) continue;
    const parsed = parseDevProposalComment(c);
    if (!parsed) { malformed++; continue; }
    if (!hasHumanApprovalFor(human, parsed.id)) continue;
    const key = normalize(parsed.entry.body); // body-hash dedupe
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({ id: parsed.id, ...parsed.entry });
  }
  return { proposals, malformed };
}

/** Deterministic hash over the entry set (order-insensitive). */
export function contractHash(entries: DevContractEntry[]): string {
  const canonical = entries
    .map(e => `${e.sources.join(' ')}\n${e.kind}\n${e.consumers.join(',')}\n${e.body}\n${(e.profileRefs ?? []).join(',')}`)
    .sort()
    .join('\n');
  return proposalIdFor(`GENERATED DEV\n${canonical}`);
}

/** The replaceable GENERATED DEV block (hash marker + entries + end marker). */
export function buildContractBlock(hash: string, entries: DevContractEntry[]): AdfNode[] {
  const block: AdfNode[] = [
    para({ t: `${MARKERS.GENERATED_DEV_HASH} ${hash}`, c: true }),
  ];
  for (const e of entries) {
    block.push(para({ t: `# kind: ${e.kind}`, c: true }));
    block.push(para({ t: `# source: ${e.sources.join('; ')}`, c: true }));
    block.push(para({ t: `# consumers: ${e.consumers.join(', ')}`, c: true }));
    if (e.profileRefs?.length) block.push(para({ t: `# profile refs: ${e.profileRefs.join(', ')}`, c: true }));
    block.push(para({ t: `# proposal: ${e.id}`, c: true }));
    block.push(para({ t: `title: ${e.title}`, b: true }));
    block.push(para(e.body));
  }
  block.push(para({ t: MARKERS.END_GENERATED_DEV, c: true }));
  return block;
}

function startSection(): AdfNode[] {
  return [para({ t: MARKERS.IMPLEMENTATION_CONTRACT, b: true })];
}

function splitContract(content: unknown[]): { before: unknown[]; after: unknown[]; hash: string | null } {
  let start = -1;
  let end = -1;
  let hash: string | null = null;
  content.forEach((node, i) => {
    const t = nodeText(node);
    if (start < 0 && t.includes(MARKERS.GENERATED_DEV_HASH)) start = i;
    if (t.includes(MARKERS.END_GENERATED_DEV)) end = i;
    const m = HASH_RE.exec(t);
    if (m) hash = m[1] as string;
  });
  if (start < 0 || end < 0 || end < start) return { before: content, after: [], hash: null };
  return { before: content.slice(0, start), after: content.slice(end + 1), hash };
}

/**
 * Merge approved contract entries into a target description as the canonical
 * `## Implementation Contract` section. Preserves everything outside the block
 * verbatim. Idempotent by hash.
 */
export function buildTargetMerge(
  description: unknown,
  entries: DevContractEntry[],
): { adf: AdfNode; hash: string; changed: boolean } {
  const hash = contractHash(entries);
  const content = asContent(description);
  const { before, after, hash: existingHash } = splitContract(content);
  const changed = existingHash !== hash;
  const block = buildContractBlock(hash, entries);
  const append = existingHash === null; // first apply → include the heading
  return {
    adf: doc(...(before as AdfNode[]), ...(append ? startSection() : []), ...block, ...(after as AdfNode[])),
    hash,
    changed,
  };
}

export function devApplySummaryComment(rows: StatusRow[], malformed: number): AdfNode {
  return doc(
    para({ t: '[AI-generated] Implementation Contract summary', b: true }),
    bullets(rows.map(r => [{ t: `${r.status}`, c: true }, ` ${r.target}`, ...(r.detail ? [` — ${r.detail}`] : [])])),
    para({ t: `Malformed: ${malformed}`, c: true }),
  );
}

async function findChildren(jira: JiraClient, projectKey: string, parentKey: string): Promise<string[]> {
  const issues = await jira.searchJql(`project = ${projectKey} AND parent = ${parentKey}`, ['key']);
  return issues.map(i => i.key as string).sort((a, b) => childOrder(a) - childOrder(b));
}

/**
 * Batch approved Implementation Contract entries into each functional child's
 * OWN description. Exclusive subticket mode; idempotent (identical hash → no
 * write); creates no work items.
 */
export async function applyApprovedDev(
  jira: JiraClient,
  input: { parentKey: string; projectKey: string },
): Promise<ApplyDevResult> {
  const children = await findChildren(jira, input.projectKey, input.parentKey);
  const targets = children.length ? children : [input.parentKey];

  const rows: StatusRow[] = [];
  const targetResults: DevTargetApply[] = [];
  let malformed = 0;

  for (const targetKey of targets) {
    const issue = (await jira.getIssue(targetKey, ['description'])) as { fields?: { description?: unknown } };
    const comments = await jira.listComments(targetKey);
    const { proposals, malformed: m } = collectDevProposals(comments);
    malformed += m;

    if (proposals.length === 0) {
      rows.push({ target: targetKey, status: 'SKIPPED', detail: 'no approved implementation contract proposals' });
      targetResults.push({ key: targetKey, status: 'SKIPPED', count: 0 });
      await unassignIfAllDecided(jira, targetKey, comments);
      continue;
    }

    const { adf, hash, changed } = buildTargetMerge(issue.fields?.description, proposals);
    if (!changed) {
      rows.push({ target: targetKey, status: 'SKIPPED', detail: 'already applied' });
      targetResults.push({ key: targetKey, status: 'SKIPPED', count: proposals.length });
      await unassignIfAllDecided(jira, targetKey, comments);
      continue;
    }

    try {
      await jira.updateIssue(targetKey, { description: adf });
      rows.push({ target: targetKey, status: 'APPLIED', detail: hash });
      targetResults.push({ key: targetKey, status: 'APPLIED', count: proposals.length });
    } catch (e) {
      rows.push({ target: targetKey, status: 'BLOCKED', detail: (e as Error).message });
      targetResults.push({ key: targetKey, status: 'BLOCKED', count: proposals.length });
      continue;
    }

    // Assignee-hygiene: no undecided proposal → drop the stale assignee.
    await unassignIfAllDecided(jira, targetKey, comments);
  }

  await jira.addComment(input.parentKey, devApplySummaryComment(rows, malformed));
  return { targets: targetResults, malformed, rows };
}
