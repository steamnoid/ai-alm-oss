import type { JiraClient } from '../alm/jira.ts';
import { type AdfNode, bullets, codeBlock, doc, para } from '../alm/adf.ts';
import { proposalHeader, proposalIdFor, normalize } from '../shared/identity.ts';
import { assignRoleApprover, type GovernanceRole } from '../governance/roles.ts';
import { hasHumanApprovalFor, unassignIfAllDecided, type ApprovalComment } from '../shared/approval.ts';

/** `sec` → Security Review; `arch` → Architecture Review. Mirrors qa/dev analyze+apply. */
export type ReviewKind = 'sec' | 'arch';

export const REVIEW: Record<ReviewKind, { label: string; heading: string; hash: string; skill: string; role: GovernanceRole }> = {
  sec: { label: 'Security Review', heading: '## Security Review', hash: 'SEC', skill: 'aialm-oss-sec-analyze', role: 'sec' },
  arch: { label: 'Architecture Review', heading: '## Architecture Review', hash: 'ARCH', skill: 'aialm-oss-arch-analyze', role: 'arch' },
};

export interface ReviewFinding {
  title: string; // short finding summary
  body: string; // plain-English finding
}

export function reviewProposalId(kind: ReviewKind, f: ReviewFinding): string {
  return proposalIdFor(`${kind}\n${f.title}\n${f.body}`);
}

function reviewProposalComment(kind: ReviewKind, key: string, f: ReviewFinding, id: string): AdfNode {
  const cfg = REVIEW[kind];
  return doc(
    para({ t: proposalHeader(key, cfg.skill, id), b: true }),
    para({ t: `proposal:${id}`, c: true }),
    para({ t: `${cfg.label} — `, b: true }, f.title),
    para(f.body),
    para(cfg.role === 'sec' || cfg.role === 'arch' ? `Approver role: ${cfg.role.toUpperCase()}` : ''),
    para('AI proposes; a human approves by commenting ✅ (or APPROVE:<id>).'),
  );
}

async function findChildren(jira: JiraClient, projectKey: string, parentKey: string): Promise<string[]> {
  const list = await jira.searchJql(`project = ${projectKey} AND parent = ${parentKey}`, ['key']);
  return list.map(i => i.key as string);
}

export interface AnalyzeReviewResult {
  kind: ReviewKind;
  targets: { key: string; posted: string[]; skipped: number }[];
}

/** Propose `kind` review findings per target; assign the role owner (sec/arch, fallback DEV). */
export async function analyzeReview(
  jira: JiraClient,
  input: { kind: ReviewKind; parentKey: string; projectKey: string; findingsByTarget: Record<string, ReviewFinding[]> },
): Promise<AnalyzeReviewResult> {
  const { kind, parentKey, projectKey, findingsByTarget } = input;
  const cfg = REVIEW[kind];
  const children = await findChildren(jira, projectKey, parentKey);
  const targets = children.length ? children : [parentKey];
  const results: AnalyzeReviewResult['targets'] = [];

  for (const targetKey of targets) {
    const findings = findingsByTarget[targetKey] ?? [];
    const comments = await jira.listComments(targetKey);
    const existing = new Set<string>();
    for (const c of comments) {
      const m = /\bproposal:\s*([0-9a-f]{7})\b/.exec(c.bodyText);
      if (m) existing.add(m[1] as string);
    }
    const posted: string[] = [];
    let skipped = 0;
    for (const f of findings) {
      const id = reviewProposalId(kind, f);
      if (existing.has(id)) { skipped++; continue; }
      await jira.addComment(targetKey, reviewProposalComment(kind, targetKey, f, id));
      posted.push(id);
      existing.add(id);
    }
    if (posted.length > 0) await assignRoleApprover(jira, targetKey, cfg.role);
    results.push({ key: targetKey, posted, skipped });
  }

  const rows = results.map(r => ({ target: r.key, status: r.posted.length ? 'CREATED' : r.skipped ? 'SKIPPED' : 'NONE', detail: r.posted.length ? `${r.posted.length} proposal(s)` : undefined }));
  await jira.addComment(parentKey, doc(
    para({ t: `[AI-generated] ${cfg.label} summary`, b: true }),
    bullets(rows.map(r => [{ t: `${r.status}`, c: true }, ` ${r.target}`, ...(r.detail ? [` — ${r.detail}`] : [])])),
  ));
  return { kind, targets: results };
}

/* ---------------- applier ---------------- */

export interface ApplyReviewResult {
  kind: ReviewKind;
  targets: { key: string; status: 'APPLIED' | 'SKIPPED' | 'BLOCKED'; count: number }[];
}

function collectApprovedReview(comments: { bodyText: string }[], kind: ReviewKind): { id: string; title: string; body: string }[] {
  const cfg = REVIEW[kind];
  const human: ApprovalComment[] = comments.filter(c => !c.bodyText.includes('[AI-generated]')).map(c => ({ id: 'x', body: c.bodyText }));
  const out: { id: string; title: string; body: string }[] = [];
  const seen = new Set<string>();
  const labelRe = new RegExp(`${cfg.label.replace(/ /g, '\\s+')}\\s*—\\s*(.+?)(?:AI proposes|$)`, '');
  for (const c of comments) {
    if (!c.bodyText.includes(cfg.skill)) continue;
    if (!c.bodyText.includes('[AI-generated]')) continue;
    const id = /\bproposal:\s*([0-9a-f]{7})\b/.exec(c.bodyText)?.[1];
    if (!id) continue;
    if (!hasHumanApprovalFor(human, id)) continue;
    const title = labelRe.exec(c.bodyText)?.[1]?.trim() ?? '';
    const key = normalize(id + title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, title, body: '' });
  }
  return out;
}

function buildReviewBlock(kind: ReviewKind, entries: { title: string; body: string }[], hash: string): AdfNode[] {
  const cfg = REVIEW[kind];
  return [
    para({ t: `<!-- ${cfg.hash} hash: ${hash} -->`, c: true }),
    ...entries.map(e => [para({ t: 'Finding: ', b: true }, e.title), para(e.body)] as AdfNode[]).flat(),
    para({ t: `<!-- END ${cfg.hash} -->`, c: true }),
  ];
}

function reviewHashText(kind: ReviewKind, entries: { title: string; body: string }[]): string {
  return proposalIdFor(`${kind}\n${entries.map(e => `${e.title}\n${e.body}`).sort().join('\n')}`);
}

function asContent(description: unknown): unknown[] {
  const c = (description as { content?: unknown[] })?.content;
  return Array.isArray(c) ? c : [];
}

function splitBlock(description: unknown, kind: ReviewKind): { before: unknown[]; after: unknown[]; hash: string | null } {
  const cfg = REVIEW[kind];
  const content = asContent(description);
  let start = -1, end = -1, hash: string | null = null;
  content.forEach((node, i) => {
    const t = JSON.stringify(node);
    if (start < 0 && t.includes(`${cfg.hash} hash:`)) start = i;
    if (t.includes(`END ${cfg.hash}`)) end = i;
    const m = new RegExp(`${cfg.hash} hash:\\s*([0-9a-f]{7})`).exec(t);
    if (m) hash = m[1]!;
  });
  return start < 0 || end < 0 || end < start ? { before: content, after: [], hash: null } : { before: content.slice(0, start), after: content.slice(end + 1), hash };
}

/** Merge approved `kind` review findings into a target's own description (idempotent by hash). */
export async function applyApprovedReview(
  jira: JiraClient,
  input: { kind: ReviewKind; parentKey: string; projectKey: string },
): Promise<ApplyReviewResult> {
  const { kind, parentKey, projectKey } = input;
  const cfg = REVIEW[kind];
  const children = await findChildren(jira, projectKey, parentKey);
  const targets = children.length ? children : [parentKey];
  const results: ApplyReviewResult['targets'] = [];

  for (const targetKey of targets) {
    const issue = (await jira.getIssue(targetKey, ['description'])) as { fields?: { description?: unknown } };
    const comments = await jira.listComments(targetKey);
    const entries = collectApprovedReview(comments, kind);
    if (entries.length === 0) {
      results.push({ key: targetKey, status: 'SKIPPED', count: 0 });
      await unassignIfAllDecided(jira, targetKey, comments);
      continue;
    }
    const hash = reviewHashText(kind, entries);
    const { before, after, hash: existingHash } = splitBlock(issue.fields?.description, kind);
    if (existingHash === hash) {
      results.push({ key: targetKey, status: 'SKIPPED', count: entries.length });
      await unassignIfAllDecided(jira, targetKey, comments);
      continue;
    }
    try {
      await jira.updateIssue(targetKey, {
        description: doc(...(before as AdfNode[]), ...(existingHash === null ? [para({ t: cfg.heading, b: true })] : []), ...buildReviewBlock(kind, entries, hash), ...(after as AdfNode[])),
      });
      results.push({ key: targetKey, status: 'APPLIED', count: entries.length });
      await unassignIfAllDecided(jira, targetKey, comments);
    } catch (e) {
      results.push({ key: targetKey, status: 'BLOCKED', count: entries.length });
    }
  }
  return { kind, targets: results };
}
