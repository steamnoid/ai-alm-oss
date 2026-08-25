import { AI_MARK } from './identity.ts';

/** Approval-shaped content: explicit approve/reject with an id, or a green checkmark. */
export const APPROVAL_SHAPE_RE =
  /\b(?:APPROVE|approve|LGTM|lgtm)\s*[:#]?\s*[0-9a-f]{7}\b|🗑️\s*[:#]?\s*[0-9a-f]{7}\b|[\u2705\u2714\u2713]/u;

export function isAiMarked(text: string): boolean {
  return text.includes(AI_MARK);
}

export function hasApprovalShape(text: string): boolean {
  return APPROVAL_SHAPE_RE.test(text);
}

/**
 * Hard write-path guard: an AI-authored comment MUST carry the `[AI-generated]`
 * marker, otherwise the approval reader would (erroneously) treat any embedded
 * `APPROVE:<id>`/✅ as a human decision. Fail fast instead of silently posting.
 */
export function assertAiCommentSafe(text: string): void {
  if (!isAiMarked(text)) {
    throw new Error(
      hasApprovalShape(text)
        ? 'AI comment carries approval-shaped content but is not marked [AI-generated] — refusing (risk of self-approval).'
        : 'AI comment must carry the [AI-generated] marker.',
    );
  }
}
