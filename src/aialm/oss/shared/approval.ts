/**
 * Comment-based human approval (aialm-oss-shared §5).
 * Jira Cloud has no reactions — the ✅|👍 channel from V4 is retired.
 * Approved iff a human comment contains APPROVE:<id> (or approve/LGTM + id).
 * Rejection: 🗑️:<id>.
 */

import { AI_MARK, isAiMarked} from './identity.ts';
import type { JiraClient } from '../alm/jira.ts';

export interface ApprovalComment {
  id: string;
  authorId?: string;
  body: string; // plain text of the comment
  isAiGenerated?: boolean; // true when the comment carries the AI mark
}

// No trailing \b: adfToPlainText glues paragraphs, so a proposal id is often
// followed by the next paragraph's first word ("…837769fVerified…") and the
// word boundary after the hex run would never match. Use a negative lookahead
// so the 7-hex capture cannot be part of a longer hex run.
const APPROVE_RE = /\b(?:APPROVE|approve|LGTM|lgtm)\s*[:#]?\s*([0-9a-f]{7})(?![0-9a-f])/;
const REJECT_RE = /🗑️\s*[:#]?\s*([0-9a-f]{7})(?![0-9a-f])/;
// Green-check approvals: ✅ (white bird in green square), ✔, ✓. A human check
// approves without needing an explicit proposal id.
const APPROVE_EMOJI = /[\u2705\u2714\u2713]/;
// No leading \b: adfToPlainText glues paragraphs ("…:<id>proposal:<id>…"), so a
// word boundary before "proposal" is not guaranteed.
const PROPOSAL_MARKER_RE = /proposal:\s*([0-9a-f]{7})/g; // no \b — adfToPlainText glues paragraphs

function extractId(re: RegExp, body: string): string | null {
  const m = re.exec(body);
  return m ? (m[1] as string) : null;
}

/** True when a human comment carries a green checkmark. */
export function hasApproveEmoji(body: string): boolean {
  return APPROVE_EMOJI.test(body);
}

/** True when the comment approves exactly this proposal id. */
export function approvesProposal(comment: ApprovalComment, proposalId: string): boolean {
  if (comment.isAiGenerated || isAiMarked(comment.body)) return false;
  if (extractId(REJECT_RE, comment.body) === proposalId) return false;
  if (extractId(APPROVE_RE, comment.body) === proposalId) return true;
  return APPROVE_EMOJI.test(comment.body);
}

/** True when the comment explicitly rejects/ignores this proposal id. */
export function rejectsProposal(comment: ApprovalComment, proposalId: string): boolean {
  if (comment.isAiGenerated || isAiMarked(comment.body)) return false;
  return extractId(REJECT_RE, comment.body) === proposalId;
}

/**
 * hasHumanApprovalFor over a set of comments.
 * AI-authored comments never count as approvals even if they quote APPROVE strings.
 */
export function hasHumanApprovalFor(comments: ApprovalComment[], proposalId: string): boolean {
  return comments.some(c => approvesProposal(c, proposalId));
}

/** Distinct proposal ids proposed by AI on the record (from `proposal:<id>` markers). */
export function aiProposalIds(comments: ApprovalComment[]): string[] {
  const ids = new Set<string>();
  for (const c of comments) {
    if (!(c.isAiGenerated || isAiMarked(c.body))) continue;
    for (const m of c.body.matchAll(PROPOSAL_MARKER_RE)) ids.add(m[1] as string);
  }
  return [...ids];
}

/** True when every AI proposal on the record has a human decision (approve or reject). */
export function allProposalsDecided(comments: ApprovalComment[]): boolean {
  const ids = aiProposalIds(comments);
  if (ids.length === 0) return true;
  return ids.every(id => hasHumanApprovalFor(comments, id) || comments.some(c => rejectsProposal(c, id)));
}

/**
 * Assignee-hygiene: after an automated step consumed approvals, clear the
 * assignee only when no proposal remains undecided. Returns true when unassigned.
 */
export async function unassignIfAllDecided(
  jira: JiraClient,
  issueKey: string,
  commentBodies: { id: string; bodyText: string }[],
): Promise<boolean> {
  const comments: ApprovalComment[] = commentBodies.map(c => ({
    id: c.id,
    body: c.bodyText,
    isAiGenerated: isAiMarked(c.bodyText),
  }));
  if (!allProposalsDecided(comments)) return false;
  await jira.unassign(issueKey);
  return true;
}
