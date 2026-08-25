import type { JiraClient } from './jira.ts';

/**
 * Role-based board columns for a team-managed kanban project.
 * These must match status names created scope=PROJECT at onboard time.
 */
export const BOARD_STATUS = {
  // Candidate / selection gate
  candidates: 'Candidates Pool',
  // PO
  poAgent: 'Agent Working (PO Analyst)',
  poAwait: 'Awaiting Approval (PO)',
  // QA
  qaAgent: 'Agent Working (QA Analyst)',
  qaAwait: 'Awaiting Approval (QA)',
  // ARCH
  archAgent: 'Agent Working (ARCH Analyst)',
  archAwait: 'Awaiting Approval (ARCH)',
  // SEC
  secAgent: 'Agent Working (SEC Analyst)',
  secAwait: 'Awaiting Approval (SEC)',
  // DEV
  devAgent: 'Agent Working (DEV Analyst)',
  devAwait: 'Awaiting Approval (DEV)',
  // Implementation tail
  qaImpl: 'Agent Working (QA Impl)',
  devImpl: 'Agent Working (DEV Impl)',
  verify: 'Agent Working (Verify)',
  pr: 'Agent Working (PR)',
  done: 'Done',
} as const;

export type BoardStatusName = (typeof BOARD_STATUS)[keyof typeof BOARD_STATUS];

/**
 * Canonical board column order for a team-managed kanban pipeline project.
 * Every entry is a distinct status; this order is the single source of truth
 * for both status provisioning (REST) and column layout (Playwright).
 * NOTE: the only default statuses a team-managed kanban ships with are
 * To Do / In Progress / In Review / Done. The role statuses below are created
 * scope=PROJECT at onboard time; the 3 generic defaults are then removed and
 * Done is kept as the terminal column.
 */
export const ROLE_COLUMNS: readonly BoardStatusName[] = [
  BOARD_STATUS.candidates,
  BOARD_STATUS.poAgent,
  BOARD_STATUS.poAwait,
  BOARD_STATUS.qaAgent,
  BOARD_STATUS.qaAwait,
  BOARD_STATUS.archAgent,
  BOARD_STATUS.archAwait,
  BOARD_STATUS.secAgent,
  BOARD_STATUS.secAwait,
  BOARD_STATUS.devAgent,
  BOARD_STATUS.devAwait,
  BOARD_STATUS.qaImpl,
  BOARD_STATUS.devImpl,
  BOARD_STATUS.verify,
  BOARD_STATUS.pr,
  BOARD_STATUS.done,
] as const;

/**
 * Status names (in ROLE_COLUMNS order) that must be created scope=PROJECT.
 * `Done` is a default status, so it is not provisioned — only the 15 role
 * statuses are.
 */
export const PROVISION_STATUSES: readonly { name: string; statusCategory: string }[] = ROLE_COLUMNS.filter(
  c => c !== BOARD_STATUS.done,
).map(name => ({ name, statusCategory: statusCategoryFor(name) }));

/** Map a status name to its Jira statusCategory id (drives column color/lane). */
export function statusCategoryFor(name: string): 'TODO' | 'IN_PROGRESS' | 'DONE' {
  if (name === BOARD_STATUS.done) return 'DONE';
  if (name.startsWith('Agent Working (')) return 'IN_PROGRESS';
  return 'TODO';
}

const AGENT_BY_SKILL: Record<string, BoardStatusName> = {
  'aialm-oss-po-analyze': BOARD_STATUS.poAgent,
  'aialm-oss-po-prep-decompose': BOARD_STATUS.poAgent,
  'aialm-oss-qa-analyze': BOARD_STATUS.qaAgent,
  'aialm-oss-arch-analyze': BOARD_STATUS.archAgent,
  'aialm-oss-sec-analyze': BOARD_STATUS.secAgent,
  'aialm-oss-dev-analyst': BOARD_STATUS.devAgent,
  'aialm-oss-qa-impl': BOARD_STATUS.qaImpl,
  'aialm-oss-dev-impl': BOARD_STATUS.devImpl,
  'aialm-oss-verify': BOARD_STATUS.verify,
  'aialm-oss-pr': BOARD_STATUS.pr,
};

/** Resolve the board column for an orchestrator action. */
export function boardColumnFor(action: {
  kind: string;
  reason?: string;
  skill?: string;
  mutator?: string;
}): BoardStatusName {
  // A waiting issue sits in the awaiting-approval column of its stage.
  // (WAIT carries only `reason`, not `skill`, so stage-await columns are decided
  // by the proposal that precedes them; the candidate gate uses the pool.)
  if (action.kind === 'WAIT') {
    if (action.reason?.includes('candidate-selection')) return BOARD_STATUS.candidates;
    return BOARD_STATUS.poAwait;
  }
  if (action.kind === 'GENERATE' && action.skill) {
    return AGENT_BY_SKILL[action.skill] ?? BOARD_STATUS.poAgent;
  }
  if (action.kind === 'APPLY' && action.mutator) {
    return postApplyColumn(action.mutator);
  }
  if (action.kind === 'POST_SELECTION') return BOARD_STATUS.poAgent;
  return BOARD_STATUS.candidates;
}

/** Refine the column after the action completes (post-apply = next gate or done). */
export function postApplyColumn(mutator: string): BoardStatusName {
  switch (mutator) {
    case 'import': return BOARD_STATUS.candidates;
    case 'decompose': return BOARD_STATUS.poAwait;
    case 'qa-apply': return BOARD_STATUS.qaImpl;
    case 'dev-apply': return BOARD_STATUS.devImpl;
    case 'sec-apply': return BOARD_STATUS.secAwait;
    case 'arch-apply': return BOARD_STATUS.archAwait;
    default: return BOARD_STATUS.verify;
  }
}
