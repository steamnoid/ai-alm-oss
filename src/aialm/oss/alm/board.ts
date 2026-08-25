import type { JiraClient } from './jira.ts';

/** The four board statuses in a team-managed kanban project. */
export const BOARD_STATUS = {
  todo: 'To Do',
  inProgress: 'In Progress',
  inReview: 'In Review',
  done: 'Done',
} as const;

export type BoardStatusName = (typeof BOARD_STATUS)[keyof typeof BOARD_STATUS];

/** Resolve the board column for an orchestrator action. */
export function boardColumnFor(action: {
  kind: string;
  reason?: string;
  skill?: string;
  mutator?: string;
}): BoardStatusName {
  if (action.kind === 'WAIT') return BOARD_STATUS.inReview;
  if (action.kind === 'GENERATE') return BOARD_STATUS.inProgress;
  if (action.kind === 'APPLY') return BOARD_STATUS.inProgress;
  return BOARD_STATUS.todo;
}

/** Refine the column after the action completes (post-apply = next gate or done). */
export function postApplyColumn(mutator: string): BoardStatusName {
  switch (mutator) {
    case 'import': return BOARD_STATUS.inProgress;
    case 'decompose': return BOARD_STATUS.inProgress;
    case 'sec-apply': case 'arch-apply': case 'dev-apply': case 'qa-apply': return BOARD_STATUS.inReview;
    default: return BOARD_STATUS.inProgress;
  }
}
