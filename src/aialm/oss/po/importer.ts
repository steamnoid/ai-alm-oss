import type { JiraClient, JiraComment } from '../alm/jira.ts';
import { type AdfNode, bullets, codeBlock, doc, para } from '../alm/adf.ts';
import { hasHumanApprovalFor, unassignIfAllDecided, type ApprovalComment } from '../shared/approval.ts';
import { AI_MARK, normalize } from '../shared/identity.ts';
import { MARKERS } from '../shared/markers.ts';
import type { ReportStatus, StatusRow } from '../shared/status.ts';
import type { ExternalSource } from '../shared/models.ts';
import { externalMarker, externalRef, extractExternalRef } from '../discover/discover.ts';

/** A well-formed proposal parsed from a candidate-record comment. */
export interface ProposalDraft {
  id: string;
  gherkin: string;
  aiGenerated: boolean;
}

export interface ImportInput {
  projectKey: string; // ALM tracking project (create target)
  candidateKey: string; // Jira candidate record carrying proposals + approvals
  external: ExternalSource; // { provider, repo, issueNumber, url, syncedAt }
  title: string; // external issue title, normalized by caller
  humanSummary?: string; // human text preserved verbatim on the record
}

export interface ImportResult {
  status: ReportStatus; // CREATED | SKIPPED | BLOCKED
  ref: string; // owner/repo#N
  approvedCount: number;
  workItemKey?: string;
  rows: StatusRow[];
}

const PROPOSAL_ID_RE = /(?:proposal|aialm-oss-po-analyze):\s*([0-9a-f]{7})/;
const WORK_ITEM_LABEL = 'work-item';

function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  const n = node as { type?: string; text?: unknown; content?: unknown[] };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) out += n.content.map(nodeText).join('');
  return out;
}

/** First codeBlock text (the Gherkin Scenario) anywhere in an ADF subtree. */
function findCodeBlock(node: unknown): string | null {
  if (node == null) return null;
  if ((node as { type?: string }).type === 'codeBlock') {
    const t = nodeText(node);
    return t.trim() || null;
  }
  const content = (node as { content?: unknown[] }).content;
  if (Array.isArray(content)) {
    for (const c of content) {
      const found = findCodeBlock(c);
      if (found != null) return found;
    }
  }
  return null;
}

/** Fallback: recover the Scenario from flattened text if ADF is unavailable. */
function gherkinFromText(text: string): string | null {
  const marker = 'Proposed acceptance criteria';
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const after = text.slice(i + marker.length);
  const j = after.indexOf('AI proposes');
  const g = (j < 0 ? after : after.slice(0, j)).replace(/^\s*\n?/, '').trim();
  return g || null;
}

/** Extract the proposal:<id> / aialm-oss-po-analyze:<id> id from a comment's text. */
export function extractProposalId(text: string): string | null {
  const m = PROPOSAL_ID_RE.exec(text);
  return m ? (m[1] as string) : null;
}

/** All well-formed proposals present on the record. */
export function extractProposals(comments: JiraComment[]): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  for (const c of comments) {
    const id = extractProposalId(c.bodyText);
    if (!id) continue;
    const gherkin = findCodeBlock(c.bodyAdf) ?? gherkinFromText(c.bodyText);
    if (!gherkin) continue;
    out.push({ id, gherkin, aiGenerated: c.bodyText.includes(AI_MARK) });
  }
  return out;
}

function toApprovalComment(c: JiraComment): ApprovalComment {
  return { id: c.id, body: c.bodyText, isAiGenerated: c.bodyText.includes(AI_MARK) };
}

/**
 * Approved, deduped, deterministically-ordered Product AC set.
 * Only AI proposal comments qualify; human approval via hasHumanApprovalFor.
 * Dedupes by normalized Gherkin hash; order is by proposal id (stable).
 */
export function approvedProposals(comments: JiraComment[]): ProposalDraft[] {
  const proposals = extractProposals(comments).filter(p => p.aiGenerated);
  const approvalComments = comments.map(toApprovalComment);
  const approved = proposals.filter(p => hasHumanApprovalFor(approvalComments, p.id));
  const seen = new Set<string>();
  const uniq: ProposalDraft[] = [];
  for (const p of approved) {
    const key = normalize(p.gherkin);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  return uniq.sort((a, b) => a.id.localeCompare(b.id));
}

/** Find an existing AI-ALM Work Item already imported for this external ref. */
export async function findExistingImport(
  jira: JiraClient,
  projectKey: string,
  ref: string,
): Promise<string | null> {
  const issues = await jira.searchJql(
    `project = ${projectKey} AND labels = ${WORK_ITEM_LABEL}`,
    ['description'],
  );
  for (const it of issues) {
    const text = JSON.stringify(it.fields?.description ?? {});
    if (extractExternalRef(text) === ref) return it.key as string;
  }
  return null;
}

/** Description of the created work item: summary + approved AC + traceability. */
export function workItemDescription(input: ImportInput, approved: ProposalDraft[]): AdfNode {
  const ref = externalRef(input.external.repo, input.external.issueNumber);
  const parts: AdfNode[] = [];
  if (input.humanSummary) parts.push(para(input.humanSummary));
  parts.push(para({ t: MARKERS.AC_SECTION, b: true }));
  for (const p of approved) {
    parts.push(codeBlock(p.gherkin));
    parts.push(para({ t: `proposal:${p.id}`, c: true }));
  }
  parts.push(para({ t: `externalSource: ${input.external.provider} ${ref} — ${input.external.url}`, c: true }));
  parts.push(para({ t: externalMarker(ref), c: true }));
  return doc(...parts);
}

/** The approved-AC + traceability section appended when a candidate is upgraded in place. */
function buildAcSection(input: ImportInput, approved: ProposalDraft[]): AdfNode[] {
  const ref = externalRef(input.external.repo, input.external.issueNumber);
  const parts: AdfNode[] = [para({ t: MARKERS.AC_SECTION, b: true })];
  for (const p of approved) {
    parts.push(codeBlock(p.gherkin));
    parts.push(para({ t: `proposal:${p.id}`, c: true }));
  }
  parts.push(para({ t: `externalSource: ${input.external.provider} ${ref} — ${input.external.url}`, c: true }));
  parts.push(para({ t: externalMarker(ref), c: true }));
  return parts;
}

/** Merge the appended AC section into an existing description, preserving everything already there. */
function mergeDescription(existing: unknown, appended: AdfNode[]): AdfNode {
  const content = ((existing as { content?: unknown[] })?.content ?? []) as AdfNode[];
  return doc(...content, ...appended);
}

function mergeLabels(existingLabels: string[] | undefined): string[] {
  return Array.from(new Set([...(existingLabels ?? []), WORK_ITEM_LABEL, 'external']));
}

/** Import Report comment using the shared status taxonomy. */
export function importReportComment(rows: StatusRow[]): AdfNode {
  return doc(
    para({ t: `[AI-generated] ${MARKERS.IMPORT_REPORT}`, b: true }),
    bullets(
      rows.map(r => [
        { t: `${r.status}`, c: true },
        ` ${r.target}`,
        ...(r.detail ? [` — ${r.detail}`] : []),
      ]),
    ),
  );
}

/**
 * DOCK importer (external → internal): turn an approved candidate into a real
 * AI-ALM Work Item. Single-create guarantee; idempotent by externalSource.
 */
export async function importWorkItem(
  jira: JiraClient,
  input: ImportInput,
): Promise<ImportResult> {
  const ref = externalRef(input.external.repo, input.external.issueNumber);
  const comments = await jira.listComments(input.candidateKey);
  const approved = approvedProposals(comments);

  // Gate: no approved proposal → BLOCKED (import gate not passed).
  if (approved.length === 0) {
    const rows: StatusRow[] = [
      { target: ref, status: 'BLOCKED', detail: 'no approved po-analyze proposal' },
    ];
    await jira.addComment(input.candidateKey, importReportComment(rows));
    return { status: 'BLOCKED', ref, approvedCount: 0, rows };
  }

  // Dedupe: never create a second work item for the same owner/repo#N.
  const existing = await findExistingImport(jira, input.projectKey, ref);
  if (existing) {
    await unassignIfAllDecided(jira, input.candidateKey, comments);
    const rows: StatusRow[] = [
      { target: ref, status: 'SKIPPED', detail: `already imported as ${existing}` },
    ];
    await jira.addComment(input.candidateKey, importReportComment(rows));
    return { status: 'SKIPPED', ref, approvedCount: approved.length, workItemKey: existing, rows };
  }

  // Single-create via in-place upgrade: the candidate record itself becomes the
  // governed AI-ALM Work Item. Preserves the existing qualification content and
  // appends the approved `## Acceptance Criteria` + externalSource traceability.
  const candidate = (await jira.getIssue(input.candidateKey, ['description', 'labels'])) as {
    fields?: { description?: unknown; labels?: string[] };
  };
  const fields = candidate.fields ?? {};
  const mergedDesc = mergeDescription(fields.description, buildAcSection(input, approved));
  await jira.updateIssue(input.candidateKey, { description: mergedDesc, labels: mergeLabels(fields.labels) });

  // Assignee-hygiene: after the import consumed the approvals, clear the assignee
  // once no proposal remains undecided (nothing left for a human to act on).
  await unassignIfAllDecided(jira, input.candidateKey, comments);

  const rows: StatusRow[] = [
    { target: ref, status: 'CREATED', detail: input.candidateKey },
  ];
  await jira.addComment(input.candidateKey, importReportComment(rows));
  return { status: 'CREATED', ref, approvedCount: approved.length, workItemKey: input.candidateKey, rows };
}
