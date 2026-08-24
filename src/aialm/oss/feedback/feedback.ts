import { type AdfNode, doc, para } from '../alm/adf.ts';
import type { FeedbackCategory, FeedbackRecord } from '../shared/models.ts';

export interface Disposition {
  action: string;
  needsApproval: boolean;
}

const CLASSIFIERS: [RegExp, FeedbackCategory][] = [
  [/blocker|unmergeable|cannot merge|merge blocking|breaking change|bloque/i, 'BLOCKER'],
  [/scope|new requirement|also need|in addition|out of scope|expand|add support for/i, 'SCOPE_CHANGE'],
  [/architecture|architect|refactor the|design|layer|pattern|module boundary|separation of concerns/i, 'ARCHITECTURE'],
  [/missing test|coverage|add a test|no test|spec for|unit test|e2e/i, 'MISSING_TEST'],
  [/bug|broken|crash|exception|error|fails|incorrect|wrong (behavior|result)|regression/i, 'BUG'],
  [/style|lint|naming|format|naming convention|typo|cosmetic/i, 'STYLE'],
  [/clarif|question|what does|could you explain|curious|understand|why (is|does)/i, 'CLARIFICATION'],
];

/** Classify a maintainer review comment into a FeedbackCategory. */
export function classifyComment(body: string): FeedbackCategory {
  for (const [re, cat] of CLASSIFIERS) {
    if (re.test(body)) return cat;
  }
  return 'CLARIFICATION';
}

/** Category → planned action (and whether renewed human approval is required). */
export function dispositionFor(category: FeedbackCategory): Disposition {
  switch (category) {
    case 'SCOPE_CHANGE':
    case 'BLOCKER':
      return { needsApproval: true, action: 'requirement delta proposal → HUMAN APPROVAL required' };
    case 'ARCHITECTURE':
      return { needsApproval: false, action: 'contract-level change proposal (aialm-oss-dev-analyst rerun)' };
    case 'BUG':
    case 'MISSING_TEST':
      return { needsApproval: false, action: 'correction mapped to existing AC / GENERATED scenarios' };
    default:
      return { needsApproval: false, action: 'correction plan (non-intent; no re-approval needed)' };
  }
}

export function needsApproval(category: FeedbackCategory): boolean {
  return dispositionFor(category).needsApproval;
}

/** Normalized, stable feedback idempotency key: owner/repo#prN/comment-id. */
export function feedbackRef(repo: string, prNumber: number, commentId: string): string {
  return `${repo}#${prNumber}/comment-${commentId}`;
}

/** True when this feedback ref is already recorded (idempotency). */
export function isRecorded(commentTexts: string[], ref: string): boolean {
  return commentTexts.some(t => t.includes(`feedback: ${ref}`));
}

/** Build a FeedbackRecord domain object. */
export function feedbackRecord(input: { category: FeedbackCategory; ref: string; disposition: string }): FeedbackRecord {
  return { source: 'maintainer', category: input.category, rawRef: input.ref, disposition: input.disposition };
}

/** Feedback Record comment: classification + planned action (no silent intent edits). */
export function feedbackRecordComment(input: { ref: string; category: FeedbackCategory; action: string; needsApproval: boolean }): AdfNode {
  return doc(
    para({ t: '[AI-generated] Feedback Record', b: true }),
    para({ t: `feedback: ${input.ref}`, c: true }),
    para({ t: `category: ${input.category}`, c: true }),
    para({ t: `action: ${input.action}`, c: true }),
    para({ t: `needs approval: ${input.needsApproval ? 'YES' : 'no'}`, c: true }),
    para('Maintainer feedback is classified; no requirement is silently rewritten. Proposals carry ids and go through the pipeline for approval.'),
  );
}

/** Access-grant proposal comment (Viewer access) requiring the human approval gate. */
export function accessGrantComment(input: { who: string; projectKey: string }): AdfNode {
  return doc(
    para({ t: '[AI-generated] Access Grant proposal', b: true }),
    para({ t: `invite: ${input.who}`, c: true }),
    para({ t: `project: ${input.projectKey}`, c: true }),
    para({ t: 'role: Viewer', c: true }),
    para('APPROVE to grant read-only visibility; the grant lands as an AccessGrant record. Revoke when the PR is merged/closed to free seats.'),
  );
}
