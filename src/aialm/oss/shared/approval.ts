/**
 * Comment-based human approval (aialm-oss-shared §5).
 * Jira Cloud has no reactions — the ✅|👍 channel from V4 is retired.
 * Approved iff a human comment contains APPROVE:<id> (or approve/LGTM + id).
 * Rejection: 🗑️:<id>.
 */

import { AI_MARK } from './identity.ts';

export interface ApprovalComment {
  id: string;
  authorId?: string;
  body: string; // plain text of the comment
  isAiGenerated?: boolean; // true when the comment carries the AI mark
}

const APPROVE_RE = /\b(?:APPROVE|approve|LGTM|lgtm)\s*[:#]?\s*([0-9a-f]{7})\b/;
const REJECT_RE = /🗑️\s*[:#]?\s*([0-9a-f]{7})\b/;

function extractId(re: RegExp, body: string): string | null {
  const m = re.exec(body);
  return m ? (m[1] as string) : null;
}

/** True when the comment approves exactly this proposal id. */
export function approvesProposal(comment: ApprovalComment, proposalId: string): boolean {
  if (comment.isAiGenerated || comment.body.includes(AI_MARK)) return false;
  if (extractId(REJECT_RE, comment.body) === proposalId) return false;
  return extractId(APPROVE_RE, comment.body) === proposalId;
}

/** True when the comment explicitly rejects/ignores this proposal id. */
export function rejectsProposal(comment: ApprovalComment, proposalId: string): boolean {
  if (comment.isAiGenerated || comment.body.includes(AI_MARK)) return false;
  return extractId(REJECT_RE, comment.body) === proposalId;
}

/**
 * hasHumanApprovalFor over a set of comments.
 * AI-authored comments never count as approvals even if they quote APPROVE strings.
 */
export function hasHumanApprovalFor(comments: ApprovalComment[], proposalId: string): boolean {
  return comments.some(c => approvesProposal(c, proposalId));
}
