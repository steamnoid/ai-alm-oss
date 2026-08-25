import type { JiraClient } from './jira.ts';
import { adfToPlainText } from './jira.ts';

/** Governed pipeline stages (ordered) and their Jira statuses. */
export const BOARD_STAGES = [
  'Candidates Pool',
  'Agent Working (PO Analyst)',
  'Awaiting Approval (PO)',
  'Agent Working (QA Analyst)',
  'Awaiting Approval (QA)',
  'Agent Working (ARCH Analyst)',
  'Awaiting Approval (ARCH)',
  'Agent Working (SEC Analyst)',
  'Awaiting Approval (SEC)',
  'Agent Working (DEV Analyst)',
  'Awaiting Approval (DEV)',
  'Agent Working (QA Impl)',
  'Agent Working (DEV Impl)',
  'Agent Working (Verify)',
  'Agent Working (PR)',
  'Done',
] as const;

export type BoardStage = (typeof BOARD_STAGES)[number];

/** Map an orchestrator skill to the stage it belongs to. */
export function skillStage(skill: string): BoardStage {
  if (skill.startsWith('aialm-oss-discover')) return 'Candidates Pool';
  if (skill.startsWith('aialm-oss-po-analyze')) return 'Agent Working (PO Analyst)';
  if (skill.startsWith('aialm-oss-po-prep-decompose')) return 'Agent Working (PO Analyst)';
  if (skill.startsWith('aialm-oss-po-decompose')) return 'Agent Working (PO Analyst)';
  if (skill.startsWith('aialm-oss-qa-analyze')) return 'Agent Working (QA Analyst)';
  if (skill.startsWith('aialm-oss-arch-analyze')) return 'Agent Working (ARCH Analyst)';
  if (skill.startsWith('aialm-oss-sec-analyze')) return 'Agent Working (SEC Analyst)';
  if (skill.startsWith('aialm-oss-dev-analyst')) return 'Agent Working (DEV Analyst)';
  if (skill.startsWith('aialm-oss-qa-impl') || skill.startsWith('aialm-oss-dev-impl')) return 'Agent Working (DEV Impl)';
  if (skill.startsWith('aialm-oss-verify')) return 'Agent Working (Verify)';
  if (skill.startsWith('aialm-oss-pr')) return 'Agent Working (PR)';
  return 'Agent Working (PO Analyst)';
}

/** Approval column for a role-gate (the stage that follows its analyst). */
export function approvalStageFor(role: 'po' | 'qa' | 'arch' | 'sec' | 'dev'): BoardStage {
  switch (role) {
    case 'po': return 'Awaiting Approval (PO)';
    case 'qa': return 'Awaiting Approval (QA)';
    case 'arch': return 'Awaiting Approval (ARCH)';
    case 'sec': return 'Awaiting Approval (SEC)';
    case 'dev': return 'Awaiting Approval (DEV)';
  }
}

function statusIdByName(statuses: { name: string; id: string }[], name: string): string | undefined {
  return statuses.find(s => s.name === name)?.id;
}

/**
 * Resolve the transition id moving `issueKey` onto `stage`'s status.
 * Falls back to a two-hop path via In Progress when no direct transition exists.
 */
export async function setStage(
  jira: JiraClient,
  issueKey: string,
  stage: BoardStage,
): Promise<{ moved: boolean; alreadyThere: boolean }> {
  const projectStatuses = await jira.getProjectStatuses(issueKey);
  const targetId = statusIdByName(projectStatuses, stage);
  if (!targetId) return { moved: false, alreadyThere: false };

  const issue = await jira.getIssue(issueKey, ['status']);
  const current = ((issue.fields as any)?.status?.name as string) ?? '';
  if (current === stage) return { moved: false, alreadyThere: true };

  // direct transition to target?
  const transitions = await jira.getTransitions(issueKey);
  const direct = transitions.find(t => t.to?.name === stage || t.name === stage);
  if (direct) {
    await jira.transitionIssue(issueKey, String(direct.id));
    return { moved: true, alreadyThere: false };
  }

  // two-hop fallback via In Progress
  const inProgress = transitions.find(t => t.to?.name === 'In Progress' || t.to?.id === '10043');
  if (inProgress) {
    await jira.transitionIssue(issueKey, String(inProgress.id));
    const second = await jira.getTransitions(issueKey);
    const to = second.find(t => t.to?.name === stage);
    if (to) {
      await jira.transitionIssue(issueKey, String(to.id));
      return { moved: true, alreadyThere: false };
    }
  }
  return { moved: false, alreadyThere: current === stage };
}

/** Read the current stage of an issue (column/status name). */
export async function readStage(jira: JiraClient, issueKey: string): Promise<BoardStage | null> {
  const issue = await jira.getIssue(issueKey, ['status']);
  const current = ((issue.fields as any)?.status?.name as string) ?? '';
  return (BOARD_STAGES as readonly string[]).includes(current) ? (current as BoardStage) : null;
}
