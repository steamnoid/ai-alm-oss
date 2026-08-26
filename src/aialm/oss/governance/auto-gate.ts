/**
 * Operator-delegated LLM gate agent ("agencik") — aialm-oss-governance §auto-gate.
 *
 * Deliberately bends the "never machine-approved" principle, therefore it only
 * ever runs behind the AIALM_GATE_MODE feature flag (default `human` = off):
 *
 *   human    — flag off: the agent refuses to act (gate-auto exits).
 *   delegate — blind operator delegation (legacy gate-auto behavior).
 *   llm      — every undecided gate is reviewed by an LLM (via `opencode run`)
 *              which returns a strict JSON verdict: approve / reject / comment /
 *              defer. The verdict is applied deterministically on the
 *              DELEGATION channel (`[delegated][llm]`, never `[AI-generated]`),
 *              so the approval reader counts it while the audit trail stays
 *              explicit about who really decided.
 *
 * This module holds the pure, testable core; scripts/gate-auto.mts wires it.
 */

import { aiProposalIds, hasHumanApprovalFor, rejectsProposal, type ApprovalComment } from '../shared/approval.ts';
import { doc, para } from '../alm/adf.ts';

// ---- mode resolution -------------------------------------------------------

export type GateMode = 'human' | 'delegate' | 'llm';

const MODES: GateMode[] = ['human', 'delegate', 'llm'];

/** CLI `--mode` wins over env `AIALM_GATE_MODE`; anything else is `human` (off). */
export function resolveGateMode(argv: Record<string, string>, env: NodeJS.ProcessEnv): GateMode {
  const raw = (argv.mode ?? env.AIALM_GATE_MODE ?? 'human').trim().toLowerCase();
  return (MODES as string[]).includes(raw) ? (raw as GateMode) : 'human';
}

// ---- pending gate collection ----------------------------------------------

export interface PendingProposal {
  kind: 'proposal';
  id: string;
  /** Plain text of the first AI-authored comment carrying `proposal:<id>`. */
  source: string;
}

export interface PendingPrGate {
  kind: 'pr-gate';
}

export type PendingGate = PendingProposal | PendingPrGate;

const PR_READY = 'READY_FOR_PR';
const PR_TRACE = 'aialm-oss-pr:';
const SELECTION_SKILL = 'aialm-oss-discover:';
const ANY_CHECKMARK = /[✅✔✓]/;

function sourceOf(comments: ApprovalComment[], id: string): string {
  const hit = comments.find(c => (c.isAiGenerated || false) && c.body.includes(`proposal:${id}`));
  return hit?.body ?? '';
}

/**
 * Every gate awaiting a decision on one record:
 * - undecided AI proposals (approved/rejected ones are skipped),
 * - the final PR gate (READY_FOR_PR present, no PR trace yet, no ✅ anywhere).
 * BLOCKED candidates are never collected unless explicitly included.
 */
export function collectPendingGates(
  comments: ApprovalComment[],
  opts: { includeBlocked?: boolean; labels?: Iterable<string> } = {},
): PendingGate[] {
  const gates: PendingGate[] = [];
  const labels = new Set(opts.labels ?? []);
  for (const id of aiProposalIds(comments)) {
    if (hasHumanApprovalFor(comments, id)) continue;
    if (comments.some(c => rejectsProposal(c, id))) continue;
    const source = sourceOf(comments, id);
    if (source.includes(SELECTION_SKILL) && labels.has('BLOCKED') && !opts.includeBlocked) continue;
    gates.push({ kind: 'proposal', id, source });
  }
  // Parity with legacy gate-auto: any checkmark anywhere settles the PR gate.
  const hasReady = comments.some(c => c.body.includes(PR_READY));
  const hasPrTrace = comments.some(c => c.body.includes(PR_TRACE));
  const hasAnyCheckmark = comments.some(c => ANY_CHECKMARK.test(c.body));
  if (hasReady && !hasPrTrace && !hasAnyCheckmark) gates.push({ kind: 'pr-gate' });
  return gates;
}

// ---- review prompt ----------------------------------------------------------

export interface ReviewContext {
  issueKey: string;
  summary: string;
  descriptionText: string;
  labels: string[];
  gates: PendingGate[];
}

const MAX_DESCRIPTION = 2500;
const MAX_SOURCE = 1800;

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…[clipped]`;
}

/**
 * Build the read-only reviewer prompt. The agent may inspect the ticket to
 * verify claims but MUST NOT mutate anything; the only output is one JSON line.
 */
export function buildReviewPrompt(ctx: ReviewContext): string {
  const proposals = ctx.gates.filter((g): g is PendingProposal => g.kind === 'proposal');
  const prGate = ctx.gates.some(g => g.kind === 'pr-gate');
  const lines: string[] = [];
  lines.push('You are acting as a DELEGATED HUMAN APPROVER at a governed pipeline gate (operator-delegated mode).');
  lines.push('READ-ONLY REVIEW: you may open/read the Jira ticket or linked GitHub material to verify claims, but you must NOT modify, comment on, transition, or create anything.');
  lines.push('');
  lines.push(`Ticket: ${ctx.issueKey} — ${ctx.summary}`);
  if (ctx.labels.length) lines.push(`Labels: ${ctx.labels.join(', ')}`);
  lines.push(`Description:\n${clip(ctx.descriptionText, MAX_DESCRIPTION)}`);
  lines.push('');
  if (proposals.length) {
    lines.push('Pending AI proposals awaiting exactly one decision each:');
    for (const p of proposals) {
      lines.push(`--- proposal:${p.id} ---`);
      lines.push(clip(p.source, MAX_SOURCE));
    }
    lines.push('');
  }
  if (prGate) {
    lines.push('FINAL PR GATE: verification reported READY_FOR_PR and no pull request exists yet. Approving here authorizes opening a PUBLIC pull request on the upstream repository.');
    lines.push('');
  }
  lines.push('Decide for EACH pending item:');
  lines.push('- approve — the proposal is concrete, testable, consistent with the ticket scope and repo conventions');
  lines.push('- reject — the proposal invents requirements, is unimplementable, out of scope, or unsafe (sends it back)');
  lines.push('- comment — you have questions or findings but are not deciding yet (posts a non-decision note)');
  lines.push('- defer — insufficient information or anything ambiguous; a human will look instead');
  lines.push('When unsure between approve and defer: DEFER.');
  lines.push('');
  lines.push(
    'Reply with EXACTLY ONE JSON object and nothing else (no prose, no code fence): '
    + '{"decision":"approve|reject|comment|defer","id":"<7-hex proposal id or null for the PR gate>","rationale":"<short reason>"}.',
  );
  return lines.join('\n');
}

// ---- verdict -----------------------------------------------------------------

export type VerdictDecision = 'approve' | 'reject' | 'comment' | 'defer';

export interface Verdict {
  decision: VerdictDecision;
  id: string | null;
  rationale: string;
}

const DECISIONS: VerdictDecision[] = ['approve', 'reject', 'comment', 'defer'];
const MAX_RATIONALE = 700;

/**
 * Parse the agent's stdout into a verdict. Anything malformed, ambiguous or
 * referencing an unknown proposal id defers — a broken answer NEVER approves.
 */
export function parseVerdict(stdout: string, validIds: ReadonlySet<string>): Verdict {
  const fallback: Verdict = { decision: 'defer', id: null, rationale: 'unparseable LLM verdict' };
  const candidates = [...stdout.matchAll(/\{[^{}]*\}/g)].map(m => m[0]);
  for (const raw of candidates.reverse()) {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;
    const decisionRaw = typeof o.decision === 'string' ? o.decision.trim().toLowerCase() : '';
    const decision = DECISIONS.find(d => d === decisionRaw);
    if (!decision) continue;
    const id = typeof o.id === 'string' && /^[0-9a-f]{7}$/.test(o.id.trim()) ? o.id.trim() : null;
    if ((decision === 'approve' || decision === 'reject') && validIds.size > 0 && (!id || !validIds.has(id))) continue;
    const rationaleRaw = typeof o.rationale === 'string' ? o.rationale : '';
    return { decision, id, rationale: sanitizeRationale(rationaleRaw).slice(0, MAX_RATIONALE) };
  }
  return fallback;
}

// ---- audit-safe posting ------------------------------------------------------

const DELEGATED_TAG = '[delegated][llm]';
const FOOTER = (at: string) =>
  `[llm-gate] decided by the LLM gate agent (opencode run) at ${at} — operator-delegated via AIALM_GATE_MODE=llm.`;

/**
 * Strip every approval/rejection-shaped token from free LLM text: the notes are
 * posted UNMARKED (that is what makes them count), so a stray `APPROVE:<id>` or
 * ✅ inside a rationale would silently become a decision for another proposal.
 */
export function sanitizeRationale(text: string): string {
  return text
    .replace(/\b(?:APPROVE|approve|LGTM|lgtm)\s*[:#]?\s*[0-9a-f]{7}\b/g, '(redacted)')
    .replace(/🗑️\s*[:#]?\s*[0-9a-f]{7}\b/gu, '(redacted)')
    .replace(/[✅✔✓]/gu, '*')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function body(decisionLine: string, rationale: string, at: string) {
  return doc(para(decisionLine), para(rationale), para({ t: FOOTER(at), c: true }));
}

/** Delegated approval comment (counts as a decision for `id`). */
export function approvalDoc(id: string, rationale: string, at: string) {
  return body(`${DELEGATED_TAG} APPROVE:${id}`, sanitizeRationale(rationale), at);
}

/** Delegated rejection comment (sends the proposal back). */
export function rejectionDoc(id: string, rationale: string, at: string) {
  return body(`${DELEGATED_TAG} 🗑️:${id}`, sanitizeRationale(rationale), at);
}

/** Delegated PR-gate approval (authorizes opening the public pull request). */
export function prGateDoc(rationale: string, at: string) {
  return doc(
    para(`${DELEGATED_TAG} ✅`),
    para(`Open the public pull request. ${sanitizeRationale(rationale)}`),
    para({ t: FOOTER(at), c: true }),
  );
}

/** Non-decision observation/question note — carries no approval-shaped content. */
export function noteDoc(rationale: string, at: string) {
  return body(`${DELEGATED_TAG} note`, sanitizeRationale(rationale), at);
}
