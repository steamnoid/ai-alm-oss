import type { JiraClient, JiraComment } from '../alm/jira.ts';
import { type AdfNode, bullets, codeBlock, doc, para } from '../alm/adf.ts';
import { hasHumanApprovalFor, unassignIfAllDecided, type ApprovalComment } from '../shared/approval.ts';
import { normalize, isAiMarked} from '../shared/identity.ts';
import { MARKERS } from '../shared/markers.ts';
import type { StatusRow } from '../shared/status.ts';
import type { ChildSpec, DecompositionPackage, ValidationResult } from './work-itemize.ts';
import { packageProposalId } from './work-itemize.ts';
import { externalMarker, extractExternalRef } from '../discover/discover.ts';

const PROPOSAL_ID_RE = /(?:proposal|aialm-oss-po-prep-decompose):\s*([0-9a-f]{7})/;

export interface ExistingChild {
  key: string;
  summary: string;
  descriptionAdf: unknown;
}

export interface ChildOutcome {
  childKey: string;
  status: 'CREATED' | 'SKIPPED' | 'FAILED' | 'NOT_ATTEMPTED';
  key?: string;
  detail?: string;
}

export interface DecomposeResult {
  status: 'CREATED' | 'SKIPPED' | 'BLOCKED' | 'PARTIAL';
  parentKey: string;
  packageId?: string;
  reason?: string;
  outcomes: ChildOutcome[];
  rows: StatusRow[];
}

function nodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  const n = node as { text?: unknown; content?: unknown[] };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) out += n.content.map(nodeText).join('');
  return out;
}

function splitList(s: string): string[] {
  return s.split(/;|,\s*/).map(x => x.trim()).filter(Boolean);
}

function toApprovalComment(c: JiraComment): ApprovalComment {
  return { id: c.id, body: c.bodyText, isAiGenerated: isAiMarked(c.bodyText) };
}

function extractProposalId(text: string): string | null {
  const m = PROPOSAL_ID_RE.exec(text);
  return m ? (m[1] as string) : null;
}

/**
 * Reverse of prep-decompose's buildPackageComment: parse an approved package
 * proposal comment ADF back into a DecompositionPackage.
 */
export function parsePackageComment(
  comment: { bodyAdf: unknown; bodyText: string },
): { packageId: string; pkg: DecompositionPackage } | null {
  const packageId = extractProposalId(comment.bodyText);
  if (!packageId) return null;
  const content = ((comment.bodyAdf as { content?: unknown[] })?.content ?? []) as { type?: string }[];
  const children: ChildSpec[] = [];
  let cur: ChildSpec | null = null;
  let sawCanonicalChild = false;
  // Tolerant fallback: agents sometimes write "C1 — Title" instead of the
  // canonical "child: <key>" line; accept both as child starts.
  const FALLBACK_CHILD_RE = /^C\d+\s*[—–-]\s*(.+)$/;
  for (const node of content) {
    if (node.type === 'codeBlock') {
      if (cur) cur.acceptanceCriteria.push(nodeText(node).trim());
      continue;
    }
    const t = nodeText(node).trim();
    if (t.startsWith('child:')) {
      sawCanonicalChild = true;
      if (cur) children.push(cur);
      cur = { childKey: t.slice(6).trim(), title: '', goal: '', scope: [], acceptanceCriteria: [], sourceProductAcRefs: [], dependencies: [] };
      continue;
    }
    if (!cur && !sawCanonicalChild) {
      const fb = FALLBACK_CHILD_RE.exec(t);
      if (fb) {
        cur = { childKey: (fb[1] as string).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), title: (fb[1] as string).trim(), goal: '', scope: [], acceptanceCriteria: [], sourceProductAcRefs: [], dependencies: [] };
        continue;
      }
    }
    if (!cur) continue;
    if (t.startsWith('Title: ')) cur.title = t.slice(7).trim();
    else if (t.startsWith('Goal: ')) cur.goal = t.slice(6).trim();
    else if (t.startsWith('Scope: ')) cur.scope = splitList(t.slice(7));
    else if (t.startsWith('Exclusions: ')) cur.exclusions = splitList(t.slice(12));
    else if (t.startsWith('Source AC refs: ')) cur.sourceProductAcRefs = splitList(t.slice(17));
    else if (t.startsWith('Dependencies: ')) cur.dependencies = t.slice(14).trim() === '(none)' ? [] : splitList(t.slice(14));
    else if (t.startsWith('Profile notes: ')) cur.profileNotes = splitList(t.slice(15));
  }
  if (cur) children.push(cur);
  if (!children.length) return null;
  return { packageId, pkg: { children } };
}

/** Latest human-approved prep-decompose package among the parent's comments. */
export function findApprovedPackage(comments: JiraComment[]): { packageId: string; pkg: DecompositionPackage } | null {
  const approvalComments = comments.map(toApprovalComment);
  let result: { packageId: string; pkg: DecompositionPackage } | null = null;
  for (const c of comments) {
    const id = extractProposalId(c.bodyText);
    if (!id) continue;
    if (!hasHumanApprovalFor(approvalComments, id)) continue;
    const parsed = parsePackageComment(c);
    if (parsed && parsed.packageId === id) result = parsed; // keep the latest
  }
  return result;
}

/**
 * Idempotency: split proposed children into already-created vs. to-create.
 * Detects by stable `childKey:` + `packageProposal:` markers in description;
 * falls back to normalized title only when the existing record has no childKey marker.
 */
export function filterExistingPayloads(
  pkg: DecompositionPackage,
  packageId: string,
  existing: ExistingChild[],
): { alreadyCreated: Set<string>; existingKey: Map<string, string> } {
  const alreadyCreated = new Set<string>();
  const existingKey = new Map<string, string>();
  const markerless = existing.filter(e => !/childKey:/.test(nodeText(e.descriptionAdf)));

  for (const c of pkg.children) {
    // 1) stable marker match
    for (const e of existing) {
      const text = nodeText(e.descriptionAdf);
      if (text.includes(`childKey:${c.childKey}`) && text.includes(`packageProposal:${packageId}`)) {
        alreadyCreated.add(c.childKey);
        existingKey.set(c.childKey, e.key);
        break;
      }
    }
    if (alreadyCreated.has(c.childKey)) continue;
    // 2) fallback: normalized title, only for markerless records
    for (const e of markerless) {
      if (normalize(e.summary) === normalize(c.title)) {
        alreadyCreated.add(c.childKey);
        existingKey.set(c.childKey, e.key);
        break;
      }
    }
  }
  return { alreadyCreated, existingKey };
}

export function validatePackageForCreate(pkg: DecompositionPackage): ValidationResult {
  const children = pkg.children;
  if (!children.length) return { ok: false, reason: 'package has no children' };
  const keys = new Set<string>();
  for (const c of children) {
    if (!c.childKey || !c.title || !c.goal) return { ok: false, reason: `child ${c.childKey ?? '(unnamed)'} missing title/goal/childKey` };
    if (!c.acceptanceCriteria?.length) return { ok: false, reason: `child ${c.childKey} missing acceptanceCriteria` };
    if (keys.has(c.childKey)) return { ok: false, reason: `duplicate childKey ${c.childKey}` };
    keys.add(c.childKey);
  }
  const cycle = detectCycle(children);
  if (cycle) return { ok: false, reason: `dependency cycle involving ${cycle}` };
  return { ok: true };
}

function detectCycle(children: ChildSpec[]): string | null {
  const keySet = new Set(children.map(c => c.childKey));
  const state = new Map<string, number>();
  function dfs(key: string): string | null {
    const st = state.get(key) ?? 0;
    if (st === 1) return key;
    if (st === 2) return null;
    state.set(key, 1);
    const child = children.find(c => c.childKey === key);
    for (const dep of child?.dependencies ?? []) {
      if (keySet.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    state.set(key, 2);
    return null;
  }
  for (const c of children) {
    const found = dfs(c.childKey);
    if (found) return found;
  }
  return null;
}

/** Topological ordering of children by dependency (null on cycle). */
export function topoOrder(children: ChildSpec[]): ChildSpec[] | null {
  const byKey = new Map(children.map(c => [c.childKey, c]));
  const keySet = new Set(byKey.keys());
  const state = new Map<string, number>();
  const result: ChildSpec[] = [];
  function visit(key: string): boolean {
    const st = state.get(key) ?? 0;
    if (st === 1) return false;
    if (st === 2) return true;
    state.set(key, 1);
    for (const d of byKey.get(key)!.dependencies) {
      if (keySet.has(d) && !visit(d)) return false;
    }
    state.set(key, 2);
    result.push(byKey.get(key)!);
    return true;
  }
  for (const c of children) if (!visit(c.childKey)) return null;
  return result;
}

/** Child work item description: inherited traceability + approved content. */
export function buildChildDescription(input: {
  parentKey: string;
  packageId: string;
  parentExternalRef: string; // owner/repo#N
  child: ChildSpec;
}): AdfNode {
  const deps = input.child.dependencies.length ? input.child.dependencies.join(', ') : '(none)';
  const parts: AdfNode[] = [
    para({ t: `**AI-generated from:** ${input.parentKey} (externalSource ${input.parentExternalRef})`, b: true }),
    para('Created by /aialm-oss-po-decompose'),
    para({ t: '## Goal', b: true }),
    para(input.child.goal),
    para({ t: '## Scope', b: true }),
    bullets(input.child.scope.map(s => [s])),
  ];
  if (input.child.exclusions?.length) parts.push(para({ t: '## Exclusions', b: true }), para(input.child.exclusions.join('; ')));
  parts.push(para({ t: MARKERS.AC_SECTION, b: true }));
  for (const a of input.child.acceptanceCriteria) parts.push(codeBlock(a));
  parts.push(
    para({ t: '## Dependencies', b: true }),
    para(deps),
    para({ t: '## Traceability', b: true }),
    para({ t: `childKey:${input.child.childKey}`, c: true }),
    para({ t: `packageProposal:${input.packageId}`, c: true }),
    para({ t: externalMarker(input.parentExternalRef), c: true }),
  );
  return doc(...parts);
}

/** Summary comment using the shared status taxonomy. */
export function decomposeReportComment(rows: StatusRow[]): AdfNode {
  return doc(
    para({ t: '[AI-generated] Decomposition summary', b: true }),
    bullets(
      rows.map(r => [{ t: `${r.status}`, c: true }, ` ${r.target}`, ...(r.detail ? [` — ${r.detail}`] : [])]),
    ),
  );
}

function extractAcFromParent(description: unknown): string[] {
  if (!description) return [];
  const adfAc = extractAcFromAdf(description);
  if (adfAc.length > 0) return adfAc;
  const text = nodeText(description);
  const parts = text.match(/Scenario:[\s\S]*?(?=Scenario:|$)/g);
  return parts ? parts.map(p => p.trim()).filter(Boolean) : [];
}

function extractAcFromAdf(description: unknown): string[] {
  const out: string[] = [];
  let inAc = false;
  (function walk(n: unknown): void {
    if (n == null) return;
    const node = n as { type?: string; text?: unknown; content?: unknown[] };
    if (typeof node.text === 'string' && node.text.includes('## Acceptance Criteria')) inAc = true;
    if (inAc && node.type === 'codeBlock') {
      const t = nodeText(n).trim();
      if (t) out.push(t);
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  })(description);
  return out;
}



async function createChildrenFromPackage(
  jira: JiraClient,
  input: { parentKey: string; projectKey: string },
  pkg: DecompositionPackage,
  packageId: string,
  parentRef: string,
  isSynthetic: boolean,
): Promise<DecomposeResult> {
  const existingChildren = await findExistingChildren(jira, input.projectKey, input.parentKey);
  const existing = filterExistingPayloads(pkg, packageId, existingChildren);
  const order = topoOrder(pkg.children) ?? pkg.children;
  const keyByChildKey = new Map(existing.existingKey);
  const failedKeys = new Set<string>();
  const outcomes: ChildOutcome[] = [];
  for (const child of order) {
    if (existing.alreadyCreated.has(child.childKey)) {
      outcomes.push({ childKey: child.childKey, status: 'SKIPPED', key: existing.existingKey.get(child.childKey), detail: 'already created' });
      continue;
    }
    const blockedByDep = child.dependencies.find(d => failedKeys.has(d));
    if (blockedByDep) {
      outcomes.push({ childKey: child.childKey, status: 'NOT_ATTEMPTED', detail: `dependency ${blockedByDep} failed` });
      continue;
    }
    try {
      let subtaskTypeId: string;
      try {
        subtaskTypeId = await jira.getIssueTypeId(input.projectKey, 'Subtask');
      } catch {
        subtaskTypeId = await jira.taskTypeId(input.projectKey);
      }
      const created = await jira.createIssue({
        project: { key: input.projectKey },
        summary: child.title,
        issuetype: { id: subtaskTypeId },
        description: buildChildDescription({ parentKey: input.parentKey, packageId, parentExternalRef: parentRef, child }),
        parent: { key: input.parentKey },
        labels: ['child', 'decomposed'],
      });
      keyByChildKey.set(child.childKey, created.key as string);
      outcomes.push({ childKey: child.childKey, status: 'CREATED', key: created.key as string });
    } catch (e) {
      failedKeys.add(child.childKey);
      outcomes.push({ childKey: child.childKey, status: 'FAILED', detail: (e as Error).message });
    }
  }
  const rows: StatusRow[] = outcomes.map(o => ({ target: o.childKey, status: o.status, detail: o.key ?? o.detail }));
  await jira.addComment(input.parentKey, decomposeReportComment(rows));
  await unassignIfAllDecided(jira, input.parentKey, await jira.listComments(input.parentKey));
  const anyBad = outcomes.some(o => o.status === 'FAILED' || o.status === 'NOT_ATTEMPTED');
  const allSkipped = outcomes.length > 0 && outcomes.every(o => o.status === 'SKIPPED');
  const status: DecomposeResult['status'] = anyBad ? 'PARTIAL' : allSkipped ? 'SKIPPED' : 'CREATED';
  return { status, parentKey: input.parentKey, packageId, outcomes, rows };
}

async function findExistingChildren(jira: JiraClient, projectKey: string, parentKey: string): Promise<ExistingChild[]> {
  const issues = await jira.searchJql(`project = ${projectKey} AND parent = ${parentKey}`, ['key', 'summary', 'description']);
  return issues.map(it => ({
    key: it.key as string,
    summary: ((it.fields as { summary?: string })?.summary ?? '') as string,
    descriptionAdf: (it.fields as { description?: unknown })?.description,
  }));
}

/**
 * Create functional children from the latest human-approved decomposition package.
 * Sequential create (decor order) — no parallel; idempotent; partial-failure aware.
 */
export async function decompose(jira: JiraClient, input: { parentKey: string; projectKey: string }): Promise<DecomposeResult> {
  const parent = (await jira.getIssue(input.parentKey, ['summary', 'description'])) as { fields?: { summary?: string; description?: unknown } };
  const parentRef = extractExternalRef(JSON.stringify(parent.fields?.description ?? {})) ?? '';
  const comments = await jira.listComments(input.parentKey);

  const approved = findApprovedPackage(comments);
  if (!approved) {
    const rows: StatusRow[] = [{ target: input.parentKey, status: 'NOT_ATTEMPTED', detail: 'no approved decomposition package' }];
    await jira.addComment(input.parentKey, decomposeReportComment(rows));
    return { status: 'BLOCKED', parentKey: input.parentKey, reason: 'no approved decomposition package', outcomes: [], rows };
  }
  const { packageId, pkg } = approved;

  const check = validatePackageForCreate(pkg);
  if (!check.ok) {
    const rows: StatusRow[] = [{ target: input.parentKey, status: 'NOT_ATTEMPTED', detail: check.reason }];
    await jira.addComment(input.parentKey, decomposeReportComment(rows));
    return { status: 'BLOCKED', parentKey: input.parentKey, packageId, reason: check.reason, outcomes: [], rows };
  }

  const existingChildren = await findExistingChildren(jira, input.projectKey, input.parentKey);
  const existing = filterExistingPayloads(pkg, packageId, existingChildren);
  const order = topoOrder(pkg.children) ?? pkg.children;
  const keyByChildKey = new Map(existing.existingKey);
  const failedKeys = new Set<string>();
  const outcomes: ChildOutcome[] = [];

  for (const child of order) {
    if (existing.alreadyCreated.has(child.childKey)) {
      outcomes.push({ childKey: child.childKey, status: 'SKIPPED', key: existing.existingKey.get(child.childKey), detail: 'already created' });
      continue;
    }
    const blockedByDep = child.dependencies.find(d => failedKeys.has(d));
    if (blockedByDep) {
      outcomes.push({ childKey: child.childKey, status: 'NOT_ATTEMPTED', detail: `dependency ${blockedByDep} failed` });
      continue;
    }
    try {
      let subtaskTypeId: string;
      try {
        subtaskTypeId = await jira.getIssueTypeId(input.projectKey, 'Subtask');
      } catch {
        subtaskTypeId = await jira.taskTypeId(input.projectKey);
      }
      const created = await jira.createIssue({
        project: { key: input.projectKey },
        summary: child.title,
        issuetype: { id: subtaskTypeId },
        description: buildChildDescription({ parentKey: input.parentKey, packageId, parentExternalRef: parentRef, child }),
        parent: { key: input.parentKey },
        labels: ['child', 'decomposed'],
      });
      keyByChildKey.set(child.childKey, created.key as string);
      outcomes.push({ childKey: child.childKey, status: 'CREATED', key: created.key as string });
    } catch (e) {
      failedKeys.add(child.childKey);
      outcomes.push({ childKey: child.childKey, status: 'FAILED', detail: (e as Error).message });
    }
  }

  const rows: StatusRow[] = outcomes.map(o => ({ target: o.childKey, status: o.status, detail: o.key ?? o.detail }));
  await jira.addComment(input.parentKey, decomposeReportComment(rows));

  // Assignee-hygiene: parents are only decomposed after package approval; once
  // decomposition ran and nothing else is undecided, clear the stale assignee.
  await unassignIfAllDecided(jira, input.parentKey, comments);

  const anyBad = outcomes.some(o => o.status === 'FAILED' || o.status === 'NOT_ATTEMPTED');
  const allSkipped = outcomes.length > 0 && outcomes.every(o => o.status === 'SKIPPED');
  const status: DecomposeResult['status'] = anyBad ? 'PARTIAL' : allSkipped ? 'SKIPPED' : 'CREATED';
  return { status, parentKey: input.parentKey, packageId, outcomes, rows };
}
