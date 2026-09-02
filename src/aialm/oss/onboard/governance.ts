/**
 * aialm-oss-onboard — Project Governance ticket (per-klient).
 *
 * Label `governance`, `## Roles` (po/qa/dev + optional sec/arch account ids)
 * oraz `## Flags` (sec/arch default ON). Idempotentny.
 */
import type { JiraClient } from '../adapter/jira.js';
import { markdownToAdf } from '../adapter/adf.js';

export interface GovernanceRoles {
  po?: string;
  qa?: string;
  dev?: string;
  sec?: string;
  arch?: string;
}

export interface GovernanceFlags {
  sec: boolean;
  arch: boolean;
}

export const GOVERNANCE_LABEL = 'governance';
export const GOVERNANCE_TITLE = 'Project Governance';

const CORE_ROLES = ['po', 'qa', 'dev'] as const;
const OPTIONAL_ROLES = ['sec', 'arch'] as const;
type GovernanceRole = (typeof CORE_ROLES)[number] | (typeof OPTIONAL_ROLES)[number];

interface Found {
  key: string;
  roles: GovernanceRoles;
  flags: GovernanceFlags;
}

/** Leniwa mapa z `shape`: surowa linia / stary {value}. */
export function parseGovernance(text: string): { roles: GovernanceRoles; flags: GovernanceFlags } {
  const roles: GovernanceRoles = {};
  const body = text.split(/\n*## Flags/)[0] ?? '';
  for (const m of body.matchAll(/^\s*(po|qa|dev|sec|arch):\s*(\S+)\s*$/gm)) {
    roles[m[1] as GovernanceRole] = m[2]!;
  }
  const flags: GovernanceFlags = { sec: true, arch: true };
  for (const m of text.matchAll(/^\s*(sec|arch):\s*(on|off)\s*$/gm)) {
    if (m[1] === 'sec') flags.sec = m[2] === 'on';
    if (m[1] === 'arch') flags.arch = m[2] === 'on';
  }
  return { roles, flags };
}

export function renderGovernance(
  roles: GovernanceRoles,
  flags: GovernanceFlags,
  leadAccountId: string,
): string {
  const roleLines = [...CORE_ROLES, ...OPTIONAL_ROLES]
    .map(k => `${k}: ${roles[k] ?? ''}`)
    .join('\n');
  const flagLines = OPTIONAL_ROLES.map(k => `${k}: ${flags[k] ? 'on' : 'off'}`).join('\n');
  return [
    `## Role`,
    `Account do pierwszego onboardu (lead): ${leadAccountId}`,
    '```',
    roleLines,
    '```',
    '',
    '## Flags',
    '```',
    flagLines,
    '```',
    '',
    'Edytuj te linie by rozdzielić odpowiedzialności; opty sec/arch domyślnie on.',
  ].join('\n');
}

/** Ensure the governance ticket exists in project (idempotent by label + title). */
export async function ensureGovernanceTicket(
  jira: JiraClient,
  input: { projectKey: string; leadAccountId: string },
): Promise<string> {
  const existing = await findGovernance(jira, input.projectKey);
  if (existing) return existing.key;

  // Roles default to lead; flags default on.
  const roles: GovernanceRoles = {
    po: input.leadAccountId,
    qa: input.leadAccountId,
    dev: input.leadAccountId,
  };
  const flags: GovernanceFlags = { sec: true, arch: true };
  const taskTypeId = await jira.issueTypeId(input.projectKey, 'Task');
  const desc = renderGovernance(roles, flags, input.leadAccountId);
  const issue = await jira.createIssue({
    project: { key: input.projectKey },
    issuetype: { id: taskTypeId },
    summary: GOVERNANCE_TITLE,
    description: markdownToAdf(desc),
    labels: [GOVERNANCE_LABEL],
  });
  return issue.key;
}

async function findGovernance(jira: JiraClient, projectKey: string): Promise<Found | null> {
  const issues = await jira.searchJql(
    `project = ${projectKey} AND labels = ${GOVERNANCE_LABEL} AND summary ~ "${GOVERNANCE_TITLE}"`,
    ['summary', 'description'],
  );
  if (!issues.length) return null;
  const it = issues[0]!;
  const desc = (it.fields as { description?: unknown } | undefined)?.description;
  const { roles, flags } = parseGovernance(desc ? String(desc) : '');
  return { key: it.key as string, roles, flags };
}