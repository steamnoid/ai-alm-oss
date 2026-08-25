import type { JiraClient, JiraComment } from '../alm/jira.ts';
import { type AdfNode, bullets, codeBlock, doc, heading, para } from '../alm/adf.ts';
import { normalize, proposalHeader, proposalIdFor } from '../shared/identity.ts';
import { MARKERS } from '../shared/markers.ts';
import type { StatusRow } from '../shared/status.ts';
import type { ProjectAiProfile } from '../shared/models.ts';
import { extractAc } from '../po/work-itemize.ts';
import { assignRoleApprover } from '../governance/roles.ts';

const DEV_SKILL = 'aialm-oss-dev-analyst';

export type DevProposalKind = 'SEAM' | 'LOCATOR' | 'API' | 'UI-STATE' | 'DATA' | 'OPEN';

export interface DevProposal {
  sourceProductAC: string[];
  sourceQaRefs?: string[];
  kind: DevProposalKind;
  consumers: string[]; // ['qa-impl','dev-impl']
  title: string;
  body: string;
  profileRefs?: string[];
}

export interface DevTargetResult {
  key: string;
  blocked: boolean;
  reason?: string;
  posted: string[]; // proposal ids
  rejected: { proposalId: string; reason: string }[];
}

export interface AnalyzeDevResult {
  targets: DevTargetResult[];
  rows: StatusRow[];
}

const HANDLED_RE = /proposal:\s*([0-9a-f]{7})/;
const GENERATED_START = 'GENERATED QA hash:';
const GENERATED_END = 'END GENERATED QA';

function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  const n = node as { text?: unknown; content?: unknown[] };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) out += n.content.map(nodeText).join('');
  return out;
}

function childOrder(key: string): number {
  const n = parseInt(key.split('-')[1] ?? '0', 10);
  return Number.isNaN(n) ? 0 : n;
}

/** proposalId = hash(normalize(sources + kind + title + body)). */
export function devProposalId(p: DevProposal): string {
  return proposalIdFor(`${p.sourceProductAC.join(' ')}\n${p.kind}\n${p.title}\n${p.body}`);
}

/** Implementation Contract Proposal envelope comment. */
export function devProposalComment(issueKey: string, p: DevProposal): AdfNode {
  const id = devProposalId(p);
  const children: AdfNode[] = [
    para({ t: proposalHeader(issueKey, DEV_SKILL, id), b: true }),
    heading(3, MARKERS.DEV_PROPOSAL_HEADING),
    para({ t: `kind: ${p.kind}`, c: true }),
    para({ t: `sources: ${p.sourceProductAC.join('; ')}`, c: true }),
  ];
  if (p.sourceQaRefs?.length) children.push(para({ t: `qa refs: ${p.sourceQaRefs.join(', ')}`, c: true }));
  children.push(para({ t: `consumers: ${p.consumers.join(', ')}`, c: true }));
  if (p.profileRefs?.length) children.push(para({ t: `profile refs: ${p.profileRefs.join(', ')}`, c: true }));
  children.push(para({ t: `title: ${p.title}`, b: true }));
  children.push(para({ t: 'Proposed contract body', b: true }));
  children.push(para(p.body));
  children.push(para({ t: `proposal:${id}`, c: true }));
  return doc(...children);
}

/** Per-target blocker when the target lacks AC or GENERATED QA. */
export function devBlockedComment(targetKey: string, reason: string): AdfNode {
  return doc(
    para({ t: `[AI-generated] Blocked — ${targetKey}`, b: true }),
    para(reason),
    para('Rerun once the target has both approved Product AC and non-empty GENERATED QA.'),
  );
}

export function devSummaryComment(rows: StatusRow[], rejectedCount: number): AdfNode {
  return doc(
    para({ t: '[AI-generated] Implementation Contract summary', b: true }),
    bullets(rows.map(r => [{ t: `${r.status}`, c: true }, ` ${r.target}`, ...(r.detail ? [` — ${r.detail}`] : [])])),
    para({ t: `Rejected (Profile-contradicting): ${rejectedCount}`, c: true }),
  );
}

/** Extract the Gherkin scenarios inside the GENERATED QA block. */
export function extractGeneratedQa(description: unknown): string[] {
  const content = (description as { content?: unknown[] })?.content ?? [];
  const out: string[] = [];
  let inBlock = false;
  for (const node of content) {
    const t = nodeText(node);
    if (t.includes(GENERATED_START)) { inBlock = true; continue; }
    if (t.includes(GENERATED_END)) { inBlock = false; continue; }
    if (inBlock && (node as { type?: string }).type === 'codeBlock') {
      const s = nodeText(node).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** A target qualifies when it has Product AC AND non-empty GENERATED QA. */
export function targetHasInputs(description: unknown): { ac: boolean; generated: boolean } {
  return { ac: extractAc(description).length > 0, generated: extractGeneratedQa(description).length > 0 };
}

/**
 * Exclusive subticket mode: analyze each functional child independently
 * (sorted by identifier), skipping legacy `QA`-prefixed titles. Falls back to
 * the single parent when no qualifying children exist.
 */
export function resolveTargets(children: { key: string; summary: string }[], parentKey: string): { targets: string[]; mode: 'children' | 'single' } {
  const filtered = children
    .filter(c => !normalize(c.summary).startsWith('qa'))
    .sort((a, b) => childOrder(a.key) - childOrder(b.key));
  if (filtered.length) return { targets: filtered.map(c => c.key), mode: 'children' };
  return { targets: [parentKey], mode: 'single' };
}

/**
 * Profile-fit validation: reject seams that contradict Project AI Profile
 * restrictions (substring, normalized). Otherwise pass through.
 */
export function validateProfileFit(proposals: DevProposal[], profile: ProjectAiProfile): { passed: DevProposal[]; rejected: { proposalId: string; reason: string }[] } {
  const banned = (profile.restrictions ?? []).map(r => normalize(r)).filter(Boolean);
  const passed: DevProposal[] = [];
  const rejected: { proposalId: string; reason: string }[] = [];
  for (const p of proposals) {
    const hay = normalize(`${p.title}\n${p.body}`);
    const hit = banned.find(r => hay.includes(r));
    if (hit) {
      rejected.push({ proposalId: devProposalId(p), reason: `contradicts Profile restriction: ${hit}` });
      continue;
    }
    passed.push(p);
  }
  return { passed, rejected };
}

async function findChildren(jira: JiraClient, projectKey: string, parentKey: string): Promise<{ key: string; summary: string }[]> {
  const issues = await jira.searchJql(`project = ${projectKey} AND parent = ${parentKey}`, ['key', 'summary']);
  return issues.map(i => ({ key: i.key as string, summary: ((i.fields as { summary?: string })?.summary ?? '') as string }));
}

/**
 * Propose Implementation Contracts for each qualifying functional child.
 * Exclusive isolation; blocked-per-target on missing AC/GENERATED QA;
 * Profile-contradicting seams rejected; idempotent by proposalId.
 */
export async function analyzeDev(
  jira: JiraClient,
  input: { parentKey: string; projectKey: string; profile: ProjectAiProfile; proposalsByTarget: Record<string, DevProposal[]> },
): Promise<AnalyzeDevResult> {
  const children = await findChildren(jira, input.projectKey, input.parentKey);
  const { targets } = resolveTargets(children, input.parentKey);
  const results: DevTargetResult[] = [];
  const rows: StatusRow[] = [];
  let rejectedTotal = 0;

  for (const targetKey of targets) {
    const issue = (await jira.getIssue(targetKey, ['description'])) as { fields?: { description?: unknown } };
    const inputs = targetHasInputs(issue.fields?.description);
    if (!inputs.ac || !inputs.generated) {
      const missing = [!inputs.ac && 'Product AC', !inputs.generated && 'GENERATED QA'].filter(Boolean).join(' and ');
      await jira.addComment(targetKey, devBlockedComment(targetKey, `missing ${missing}`));
      rows.push({ target: targetKey, status: 'BLOCKED', detail: `missing ${missing}` });
      results.push({ key: targetKey, blocked: true, reason: `missing ${missing}`, posted: [], rejected: [] });
      continue;
    }

    const proposals = input.proposalsByTarget[targetKey] ?? [];
    const { passed, rejected } = validateProfileFit(proposals, input.profile);
    rejectedTotal += rejected.length;

    const comments = await jira.listComments(targetKey);
    const existingIds = new Set<string>();
    for (const c of comments) {
      const m = HANDLED_RE.exec(c.bodyText);
      if (m) existingIds.add(m[1] as string);
    }

    const posted: string[] = [];
    for (const p of passed) {
      const id = devProposalId(p);
      if (existingIds.has(id)) continue;
      await jira.addComment(targetKey, devProposalComment(targetKey, p));
      posted.push(id);
      existingIds.add(id);
    }
    // Assignee-hygiene: DEV proposals posted → the DEV owner must act; assign them.
    if (posted.length > 0) await assignRoleApprover(jira, targetKey, 'dev');
    rows.push({ target: targetKey, status: posted.length ? 'CREATED' : 'SKIPPED', detail: posted.length ? `${posted.length} proposal(s)` : rejected.length ? 'no qualifying proposals' : 'none' });
    results.push({ key: targetKey, blocked: false, posted, rejected });
  }

  await jira.addComment(input.parentKey, devSummaryComment(rows, rejectedTotal));
  return { targets: results, rows };
}
