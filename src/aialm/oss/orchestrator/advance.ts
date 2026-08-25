import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { JiraClient } from '../alm/jira.ts';
import { doc, para } from '../alm/adf.ts';
import { extractAc } from '../po/work-itemize.ts';
import { hasHumanApprovalFor, type ApprovalComment } from '../shared/approval.ts';
import { assignRoleApprover } from '../governance/roles.ts';
import { importWorkItem } from '../po/importer.ts';
import { decompose } from '../po/decomposer.ts';
import { applyApprovedQa } from '../qa/applier.ts';
import { applyApprovedDev } from '../dev/applier.ts';
import { applyApprovedReview } from '../review/review.ts';
import { buildSelectionProposalDoc, selectionProposalId } from '../discover/discover.ts';
import { enqueueGenerative, hasActiveJob } from './queue.ts';
import { boardColumnFor, postApplyColumn, BOARD_STATUS, type BoardStatusName } from '../alm/board.ts';
import { extractExternalRef } from '../discover/discover.ts';

const PO = 'aialm-oss-po-analyze:';
const PREP = 'aialm-oss-po-prep-decompose:';
const QA = 'aialm-oss-qa-analyze:';
const DEV = 'aialm-oss-dev-analyst:';
const SEC = 'aialm-oss-sec-analyze:';
const ARCH = 'aialm-oss-arch-analyze:';
const QAI = 'aialm-oss-qa-impl';
const DEVI = 'aialm-oss-dev-impl';
const READY = 'READY_FOR_PR';
const PR = 'aialm-oss-pr';

const STATE_DIR = 'state';

export interface OrchestratorState {
  cursor: string | null;
  consumed: string[];
}

export type OrchestratorAction =
  | { kind: 'NONE' }
  | { kind: 'WAIT'; reason: string }
  | { kind: 'GENERATE'; skill: string; targetKey: string; repoRef: string }
  | { kind: 'POST_SELECTION'; targetKey: string; projectKey: string; ref: string }
  | { kind: 'APPLY'; mutator: 'import' | 'decompose' | 'qa-apply' | 'dev-apply' | 'sec-apply' | 'arch-apply'; targetKey: string; projectKey: string; ref: string };

function statePath(projectKey: string): string {
  return resolve(STATE_DIR, `${projectKey}.json`);
}

function loadState(projectKey: string): OrchestratorState {
  const p = statePath(projectKey);
  if (!existsSync(p)) return { cursor: null, consumed: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as OrchestratorState;
  } catch {
    return { cursor: null, consumed: [] };
  }
}

function saveState(projectKey: string, s: OrchestratorState): void {
  mkdirSync(dirname(statePath(projectKey)), { recursive: true });
  writeFileSync(statePath(projectKey), JSON.stringify(s, null, 2));
}

function human(comments: { bodyText: string }[]): ApprovalComment[] {
  return comments
    .filter(c => !c.bodyText.includes('[AI-generated]'))
    .map(c => ({ id: 'x', body: c.bodyText, isAiGenerated: false }));
}

function hasMarker(comments: { bodyText: string }[], marker: string): boolean {
  return comments.some(c => c.bodyText.includes(marker));
}

function approvedIds(comments: { bodyText: string }[], marker: string): string[] {
  const hs = human(comments);
  const ids = new Set<string>();
  for (const c of comments) {
    if (!c.bodyText.includes(marker)) continue;
    const m = /\bproposal:\s*([0-9a-f]{7})\b/.exec(c.bodyText);
    if (m && hasHumanApprovalFor(hs, m[1] as string)) ids.add(m[1] as string);
  }
  return [...ids];
}

async function findChildren(jira: JiraClient, projectKey: string, parentKey: string): Promise<string[]> {
  const list = await jira.searchJql(`project = ${projectKey} AND parent = ${parentKey}`, ['key']);
  return list.map(i => i.key as string);
}

function refOf(description: unknown): string {
  return extractExternalRef(JSON.stringify(description ?? {})) ?? '';
}

function commentsOf(jira: JiraClient, key: string): Promise<{ bodyText: string }[]> {
  return jira.listComments(key);
}

/** Deterministically post the candidate-selection proposal (no agent involved). */
async function postSelectionProposal(jira: JiraClient, act: Extract<OrchestratorAction, { kind: 'POST_SELECTION' }>, dry: boolean): Promise<string> {
  if (dry) return `dry:selection:${act.targetKey}`;
  const parsed = parseExternalRef(act.ref);
  const issue = (await jira.getIssue(act.targetKey, ['summary'])) as { fields?: { summary?: string } };
  const title = issue.fields?.summary?.replace(/^\[candidate\]\s*/, '') ?? '';
  await jira.addAiComment(act.targetKey, buildSelectionProposalDoc({
    repo: parsed.repo,
    number: parsed.issueNumber,
    title,
    url: parsed.url,
    recommendation: 'READY',
  }));
  await assignRoleApprover(jira, act.targetKey, 'po');
  return `selection-posted:${act.targetKey}`;
}

/** Deterministic candidate-gate step (part of applyDeterministic switch). */

/** Post a stage-status comment once (idempotent by its marker). */
async function postStageStatus(jira: JiraClient, key: string, comments: { bodyText: string }[], text: string): Promise<void> {
  if (comments.some(c => c.bodyText.includes(`[status] ${text}`))) return;
  await jira.addAiComment(key, doc(para({ t: `[status] ${text}`, c: true })));
}

/** Resolve the next governed action for one issue from description + comments + labels. */
export async function resolveNext(
  jira: JiraClient,
  input: { projectKey: string; issueKey: string },
): Promise<OrchestratorAction> {
  const issue = (await jira.getIssue(input.issueKey, ['key', 'summary', 'description', 'labels'])) as {
    fields?: { key?: string; description?: unknown; labels?: string[] };
  };
  const fields = issue.fields ?? {};
  const key = (fields.key ?? input.issueKey) as string;
  const labels = new Set(fields.labels ?? []);
  const description = fields.description;
  const hasAc = extractAc(description).length > 0;
  // Only governed artifacts are advanced: candidates, work items and their
  // functional children. Everything else (Profile, Governance, CI tickets…) is
  // not the orchestrator's business.
  const isTracked = ['candidate', 'external', 'work-item', 'child', 'decomposed'].some(l => labels.has(l));
  if (!isTracked) return { kind: 'NONE' };

  if (!hasAc && isTracked) {
    const comments = await jira.listComments(key);
    // Candidate selection gate (same convention as every other gate): the
    // pipeline never starts an un-approved candidate.
    if (!hasMarker(comments, 'aialm-oss-discover:')) {
      return { kind: 'POST_SELECTION', targetKey: key, projectKey: input.projectKey, ref: refOf(description) };
    }
    if (approvedIds(comments, 'aialm-oss-discover:').length === 0) {
      await postStageStatus(jira, key, comments, 'awaiting candidate-selection approval — comment ✅ or APPROVE:<id> on the selection proposal');
      return { kind: 'WAIT', reason: 'awaiting candidate-selection approval (APPROVE/✅)' };
    }
    if (approvedIds(comments, PO).length > 0) {
      return { kind: 'APPLY', mutator: 'import', targetKey: key, projectKey: input.projectKey, ref: refOf(description) };
    }
    if (hasMarker(comments, PO)) {
      await postStageStatus(jira, key, comments, 'awaiting your approval on the AC proposal(s) — comment ✅ or APPROVE:<id>');
      return { kind: 'WAIT', reason: 'po proposals present, await approval' };
    }
    return { kind: 'GENERATE', skill: 'aialm-oss-po-analyze', targetKey: key, repoRef: refOf(description) };
  }

  const children = await findChildren(jira, input.projectKey, key);
  if (children.length > 0) {
    for (const c of children) {
      if (approvedIds(await jira.listComments(c), QA).length > 0) {
        return { kind: 'APPLY', mutator: 'qa-apply', targetKey: c, projectKey: input.projectKey, ref: refOf(description) };
      }
    }
    for (const c of children) {
      if (approvedIds(await jira.listComments(c), DEV).length > 0) {
        return { kind: 'APPLY', mutator: 'dev-apply', targetKey: c, projectKey: input.projectKey, ref: refOf(description) };
      }
    }
    for (const c of children) {
      const q = await jira.listComments(c);
      if (!hasMarker(q, QA)) return { kind: 'GENERATE', skill: 'aialm-oss-qa-analyze', targetKey: c, repoRef: refOf(description) };
      if (!hasMarker(q, DEV)) return { kind: 'GENERATE', skill: 'aialm-oss-dev-analyst', targetKey: c, repoRef: refOf(description) };
    }
    // SEC/ARCH review (after QA+DEV proposals exist), fallback handled by role config
    for (const c of children) {
      const q = await jira.listComments(c);
      if (!hasMarker(q, SEC)) return { kind: 'GENERATE', skill: 'aialm-oss-sec-analyze', targetKey: c, repoRef: refOf(description) };
      if (approvedIds(q, SEC).length > 0) return { kind: 'APPLY', mutator: 'sec-apply', targetKey: c, projectKey: input.projectKey, ref: refOf(description) };
    }
    for (const c of children) {
      const q = await jira.listComments(c);
      if (!hasMarker(q, ARCH)) return { kind: 'GENERATE', skill: 'aialm-oss-arch-analyze', targetKey: c, repoRef: refOf(description) };
      if (approvedIds(q, ARCH).length > 0) return { kind: 'APPLY', mutator: 'arch-apply', targetKey: c, projectKey: input.projectKey, ref: refOf(description) };
    }
    // implementation tail: qa-impl ∥ dev-impl → verify → pr
    for (const c of children) {
      const q = await jira.listComments(c);
      if (!hasMarker(q, QAI)) return { kind: 'GENERATE', skill: 'aialm-oss-qa-impl', targetKey: c, repoRef: refOf(description) };
      if (!hasMarker(q, DEVI)) return { kind: 'GENERATE', skill: 'aialm-oss-dev-impl', targetKey: c, repoRef: refOf(description) };
    }
    const parentComments = await jira.listComments(key);
    if (!hasMarker(parentComments, READY)) return { kind: 'GENERATE', skill: 'aialm-oss-verify', targetKey: key, repoRef: refOf(description) };
    if (!hasMarker(parentComments, PR)) return { kind: 'GENERATE', skill: 'aialm-oss-pr', targetKey: key, repoRef: refOf(description) };
    return { kind: 'WAIT', reason: 'children present, awaiting PR' };
  }

  const comments = await jira.listComments(key);
  if (approvedIds(comments, PREP).length > 0) {
    return { kind: 'APPLY', mutator: 'decompose', targetKey: key, projectKey: input.projectKey, ref: refOf(description) };
  }
  if (hasMarker(comments, PREP)) return { kind: 'WAIT', reason: 'decomposition package awaiting approval' };
  return { kind: 'GENERATE', skill: 'aialm-oss-po-prep-decompose', targetKey: key, repoRef: refOf(description) };
}

function parseExternalRef(ref: string): { provider: 'github'; repo: string; issueNumber: number; url: string; syncedAt: string } {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref);
  const repo = m ? m[1]! : 'unknown/repo';
  const issueNumber = m ? Number(m[2]) : 0;
  return { provider: 'github', repo, issueNumber, url: `https://github.com/${repo}/issues/${issueNumber}`, syncedAt: new Date().toISOString() };
}

async function applyDeterministic(jira: JiraClient, act: Extract<OrchestratorAction, { kind: 'APPLY' }>, dry: boolean): Promise<string> {
  if (dry) return `dry:${act.mutator}:${act.targetKey}`;
  switch (act.mutator) {
    case 'import': {
      const r = await importWorkItem(jira, { projectKey: act.projectKey, candidateKey: act.targetKey, external: parseExternalRef(act.ref), title: act.targetKey });
      return `import:${r.status}`;
    }
    case 'decompose': {
      const r = await decompose(jira, { parentKey: act.targetKey, projectKey: act.projectKey });
      return `decompose:${r.status}`;
    }
    case 'qa-apply': {
      const r = await applyApprovedQa(jira, { parentKey: act.targetKey, projectKey: act.projectKey });
      return `qa-apply:${r.targets.map(t => t.status).join(',')}`;
    }
    case 'dev-apply': {
      const r = await applyApprovedDev(jira, { parentKey: act.targetKey, projectKey: act.projectKey });
      return `dev-apply:${r.targets.map(t => t.status).join(',')}`;
    }
    case 'sec-apply': {
      const r = await applyApprovedReview(jira, { kind: 'sec', parentKey: act.targetKey, projectKey: act.projectKey });
      return `sec-apply:${r.targets.map(t => t.status).join(',')}`;
    }
    case 'arch-apply': {
      const r = await applyApprovedReview(jira, { kind: 'arch', parentKey: act.targetKey, projectKey: act.projectKey });
      return `arch-apply:${r.targets.map(t => t.status).join(',')}`;
    }
  }
}

export interface AdvanceResult {
  projectKey: string;
  scanned: number;
  actions: { key: string; action: string; detail: string }[];
  cursor: string | null;
}

export type GenerativeRunner = (a: Extract<OrchestratorAction, { kind: 'GENERATE' }>) => Promise<string>;

function workerPool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(workers, queue.length) || 1 }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  return Promise.all(runners).then(() => undefined);
}

/** Normalize any timestamp into a JQL-safe `YYYY-MM-DD HH:MM` string. */
function jqlTimestamp(ts: string | null): string {
  if (!ts) return '1970-01-01 00:00';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '1970-01-01 00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}


/** One poll pass: read the delta via the `updated`-cursor and advance each changed issue. */
export async function advance(
  jira: JiraClient,
  input: { projectKey: string; dry?: boolean; cursorOverride?: string; workers?: number },
): Promise<AdvanceResult> {
  const { projectKey, dry = false, workers = 4 } = input;
  const state = loadState(projectKey);
  const cursor = input.cursorOverride ?? state.cursor ?? '';
  const jql = `project = ${projectKey} AND updated >= "${jqlTimestamp(cursor)}" ORDER BY updated ASC`;
  const issues = await jira.searchJql(jql, ['key', 'summary', 'description', 'labels', 'updated']);
  const actions: AdvanceResult['actions'] = [];
  let maxUpdated = cursor;

  // Resolve every changed issue's next action (independent, reads-only; fault-isolated).
  const resolved: { key: string; action: OrchestratorAction }[] = [];
  const resolveErrors: { key: string; detail: string }[] = [];
  for (const it of issues) {
    const key = it.key as string;
    const updated = ((it.fields as { updated?: string })?.updated ?? '') as string;
    if (updated && updated > maxUpdated) maxUpdated = updated;
    try {
      const action = await resolveNext(jira, { projectKey, issueKey: key });
      resolved.push({ key, action });
    } catch (e) {
      resolveErrors.push({ key, detail: (e as Error).message });
    }
  }

  // Execute concurrently (bounded). Different issues → different work items/branches.
  const results: { key: string; action: string; detail: string }[] = [];
  for (const r of resolveErrors) results.push({ key: r.key, action: 'ERROR', detail: r.detail });
  await workerPool(resolved, workers, async ({ key, action }) => {
    try {
      if (action.kind === 'NONE') return;
      let detail = '';
      if (action.kind === 'WAIT') detail = `wait:${action.reason}`;
      else if (action.kind === 'APPLY') detail = await applyDeterministic(jira, action, dry);
      else if (action.kind === 'POST_SELECTION') detail = await postSelectionProposal(jira, action, dry);
      else {
        // Generative step: enqueue for the async worker — never blocks the pass.
        if (dry) detail = `dry:${action.skill}:${action.targetKey}`;
        else if (hasActiveJob(projectKey, action.skill, action.targetKey)) detail = `queued:${action.skill}:${action.targetKey}`;
        else {
          const enq = enqueueGenerative(projectKey, { skill: action.skill, targetKey: action.targetKey, repoRef: action.repoRef });
          detail = enq.enqueued ? `enqueued:${action.skill}:${action.targetKey}` : `already-queued:${action.skill}`;
        }
      }
      results.push({ key, action: action.kind, detail });
      state.consumed.push(`${key}:${action.kind}:${detail}`);

      // Board sync: move ticket to the right column (best effort).
      if (!dry) {
        try {
          const col = boardColumnFor({ kind: action.kind, reason: action.kind === 'WAIT' ? action.reason : undefined, skill: action.kind === 'GENERATE' ? action.skill : action.kind === 'APPLY' ? action.mutator : undefined });
          const transitions = await jira.getTransitions(key);
          const tr = transitions.find(t => t.to?.name === col || t.name === col);
          if (tr) await jira.transitionIssue(key, tr.id);
        } catch { /* best-effort */ }
      }
    } catch (e) {
      results.push({ key, action: 'ERROR', detail: (e as Error).message });
    }
  });

  try {
    results.sort((a, b) => a.key.localeCompare(b.key));
    actions.push(...results);
    state.cursor = maxUpdated || state.cursor;
  } finally {
    // Always persist the cursor/ledger — even when a pass partially fails —
    // so the poller never re-scans the whole project.
    if (!dry) saveState(projectKey, state);
  }
  return { projectKey, scanned: issues.length, actions, cursor: state.cursor };
}
