import type { JiraClient } from '../alm/jira.ts';
import { type AdfNode, codeBlock, doc, para } from '../alm/adf.ts';
import { proposalHeader, proposalIdFor, normalize } from '../shared/identity.ts';
import { MARKERS } from '../shared/markers.ts';
import { assignRoleApprover } from '../governance/roles.ts';

const PREP_SKILL = 'aialm-oss-po-prep-decompose';

/** One independently-implementable functional child inside a decomposition package. */
export interface ChildSpec {
  childKey: string; // stable id inside the package
  title: string;
  goal: string;
  scope: string[];
  exclusions?: string[];
  acceptanceCriteria: string[]; // Gherkin-ready subset of parent AC
  sourceProductAcRefs: string[]; // parent AC refs this child satisfies
  dependencies: string[]; // other childKeys or external refs
  profileNotes?: string[]; // convention constraints from the Project AI Profile
}

export interface DecompositionPackage {
  children: ChildSpec[];
}

export interface PrepResult {
  status: 'CREATED' | 'SKIPPED' | 'BLOCKED';
  packageId?: string;
  reason?: string;
  childCount: number;
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

/** Refs a parent AC by its canonical hash — used for coverage bookkeeping. */
export function acRef(ac: string): string {
  return proposalIdFor(ac);
}

/**
 * Extract the Gherkin Scenarios under the `## Acceptance Criteria` heading.
 * Walks ADF, collecting codeBlocks only after the AC section marker.
 */
export function extractAc(description: unknown): string[] {
  const out: string[] = [];
  let inAc = false;
  (function walk(n: unknown): void {
    if (n == null) return;
    if (typeof n === 'string') {
      if (n.includes(MARKERS.AC_SECTION)) inAc = true;
      return;
    }
    const node = n as { type?: string; text?: unknown; content?: unknown[] };
    if (typeof node.text === 'string' && node.text.includes(MARKERS.AC_SECTION)) inAc = true;
    if (inAc && node.type === 'codeBlock') {
      const t = nodeText(n).trim();
      if (t) out.push(t);
      return;
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  })(description);
  return out;
}

/** Text-only fallback: split Scenarios or lines under the AC heading. */
export function extractAcFromText(text: string): string[] {
  const i = text.indexOf(MARKERS.AC_SECTION);
  if (i < 0) return [];
  const rest = text.slice(i + MARKERS.AC_SECTION.length);
  const end = rest.indexOf('externalSource:');
  const ac = (end < 0 ? rest : rest.slice(0, end)).trim();
  if (!ac) return [];
  const parts = ac.match(/Scenario:[\s\S]*?(?=Scenario:|$)/g);
  return parts ? parts.map(p => p.trim()).filter(Boolean) : ac.split(/\n-?\s*/).map(s => s.trim()).filter(Boolean);
}

/** Canonical stable serialization of a package (sorted keys + sorted string arrays). */
function stableValue(v: unknown): unknown {
  if (Array.isArray(v)) {
    const mapped = v.map(stableValue);
    return mapped.every(x => typeof x === 'string') ? mapped.slice().sort() : mapped;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = stableValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return typeof v === 'string' ? normalize(v) : v;
}

/** packageProposalId = hash(norm(package payload)) — idempotency key for the package. */
export function packageProposalId(pkg: DecompositionPackage): string {
  return proposalIdFor(JSON.stringify(stableValue(pkg)));
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function detectCycle(children: ChildSpec[]): string | null {
  const byKey = new Map(children.map(c => [c.childKey, c.childKey]));
  const keySet = new Set(byKey.keys());
  const state = new Map<string, number>(); // 0 vis, 1 visiting, 2 done
  const visiting: string[] = [];
  function dfs(key: string): string | null {
    const st = state.get(key) ?? 0;
    if (st === 1) return key; // back edge
    if (st === 2) return null;
    state.set(key, 1);
    visiting.push(key);
    const child = children.find(c => c.childKey === key);
    for (const dep of child?.dependencies ?? []) {
      if (keySet.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    state.set(key, 2);
    visiting.pop();
    return null;
  }
  for (const c of children) {
    const found = dfs(c.childKey);
    if (found) return found;
  }
  return null;
}

/**
 * Validate an LLM-proposed package against the parent AC set.
 * Enforces: required child fields, unique childKeys, acyclic deps, and full AC
 * coverage (else explicit omission).
 */
export function validatePackage(pkg: DecompositionPackage, parentAc: string[]): ValidationResult {
  const children = pkg.children;
  if (!children || children.length === 0) return { ok: false, reason: 'package has no children' };

  const keys = new Set<string>();
  for (const c of children) {
    if (!c.childKey || !c.title || !c.goal) {
      return { ok: false, reason: `child ${c.childKey ?? '(unnamed)'} missing required title/goal/childKey` };
    }
    if (!c.scope?.length) return { ok: false, reason: `child ${c.childKey} missing scope` };
    if (!c.acceptanceCriteria?.length) return { ok: false, reason: `child ${c.childKey} missing acceptanceCriteria` };
    if (!c.sourceProductAcRefs?.length) return { ok: false, reason: `child ${c.childKey} missing sourceProductAcRefs` };
    if (!Array.isArray(c.dependencies)) return { ok: false, reason: `child ${c.childKey} missing dependencies` };
    if (keys.has(c.childKey)) return { ok: false, reason: `duplicate childKey ${c.childKey}` };
    keys.add(c.childKey);
  }

  const cycle = detectCycle(children);
  if (cycle) return { ok: false, reason: `dependency cycle involving ${cycle}` };

  if (parentAc.length > 0) {
    const parentRefs = new Set(parentAc.map(acRef));
    const covered = new Set<string>();
    for (const c of children) {
      for (const r of c.sourceProductAcRefs) {
        if (!parentRefs.has(r)) return { ok: false, reason: `child ${c.childKey} references unknown parent AC ${r}` };
        covered.add(r);
      }
    }
    const missing = [...parentRefs].filter(r => !covered.has(r));
    if (missing.length) return { ok: false, reason: `AC coverage incomplete; missing refs ${missing.join(', ')}` };
  }

  return { ok: true };
}

/** Single primary proposal comment carrying all child specs. */
export function buildPackageComment(issueKey: string, pkg: DecompositionPackage, packageId: string): AdfNode {
  const children: AdfNode[] = [
    para({ t: proposalHeader(issueKey, PREP_SKILL, packageId), b: true }),
    para({ t: `proposal:${packageId}`, c: true }),
    para({ t: `Package proposal — ${pkg.children.length} child work items`, b: true }),
  ];
  for (const c of pkg.children) {
    children.push(para({ t: `child:${c.childKey}`, c: true }));
    children.push(para({ t: 'Title: ', b: true }, c.title));
    children.push(para({ t: 'Goal: ', b: true }, c.goal));
    children.push(para({ t: 'Scope: ', b: true }, c.scope.join('; ')));
    if (c.exclusions?.length) children.push(para({ t: 'Exclusions: ', b: true }, c.exclusions.join('; ')));
    children.push(para({ t: 'Acceptance criteria', b: true }));
    for (const a of c.acceptanceCriteria) children.push(codeBlock(a));
    children.push(para({ t: 'Source AC refs: ', c: true }, c.sourceProductAcRefs.join(', ')));
    children.push(para({ t: 'Dependencies: ', b: true }, c.dependencies.join(', ') || '(none)'));
    if (c.profileNotes?.length) children.push(para({ t: 'Profile notes: ', b: true }, c.profileNotes.join('; ')));
  }
  children.push(para('AI proposes; a human approves by commenting ✅ (or APPROVE:<id>).'));
  return doc(...children);
}

/** Work-itemization blocked comment (no fake split). */
export function workItemizationBlockedComment(reason: string): AdfNode {
  return doc(
    para({ t: `${MARKERS.WORK_ITEMIZATION} — Blocked`, b: true }),
    para(reason),
    para('Rerun once the parent is sufficiently specified; no fake split.'),
  );
}

/**
 * Propose a single decomposition package for one AI-ALM Work Item.
 * Creates NO children — only one primary proposal comment (idempotent).
 */
export async function prepDecompose(
  jira: JiraClient,
  input: { workItemKey: string; pkg: DecompositionPackage },
): Promise<PrepResult> {
  const parent = await jira.getIssue(input.workItemKey, ['description', 'summary']);
  const parentAc = extractAc((parent as { fields?: { description?: unknown } }).fields?.description);

  if (parentAc.length === 0) {
    const reason = 'parent has no approved ## Acceptance Criteria to decompose against';
    await jira.addComment(input.workItemKey, workItemizationBlockedComment(reason));
    return { status: 'BLOCKED', reason, childCount: input.pkg.children.length };
  }

  const check = validatePackage(input.pkg, parentAc);
  if (!check.ok) {
    await jira.addComment(input.workItemKey, workItemizationBlockedComment(check.reason));
    return { status: 'BLOCKED', reason: check.reason, childCount: input.pkg.children.length };
  }

  const packageId = packageProposalId(input.pkg);
  const comments = await jira.listComments(input.workItemKey);
  const dup = comments.some(c => /proposal:\s*([0-9a-f]{7})/.exec(c.bodyText)?.[1] === packageId);
  if (dup) return { status: 'SKIPPED', packageId, childCount: input.pkg.children.length };

  await jira.addComment(input.workItemKey, buildPackageComment(input.workItemKey, input.pkg, packageId));
  // Assignee-hygiene: the package proposal needs a PO decision → assign the PO owner.
  await assignRoleApprover(jira, input.workItemKey, 'po');
  return { status: 'CREATED', packageId, childCount: input.pkg.children.length };
}
