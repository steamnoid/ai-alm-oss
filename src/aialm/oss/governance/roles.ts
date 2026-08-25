import type { JiraClient } from '../alm/jira.ts';
import { adfToPlainText } from '../alm/jira.ts';
import { codeBlock, doc, para, type AdfNode } from '../alm/adf.ts';

/** Role → account (mail or accountId), per-project, in the `Project Governance` ticket. */
export interface GovernanceRoles {
  po?: string;
  qa?: string;
  dev?: string;
  sec?: string;
  arch?: string;
}

/** Optional role activation flags (default on — security/arch oversight is opt-out). */
export interface GovernanceFlags {
  sec: boolean;
  arch: boolean;
}

export interface GovernanceConfig {
  roles: GovernanceRoles;
  flags: GovernanceFlags;
}

/** `po | qa | dev` are always on; `sec | arch` are optional (flag-gated). */
export const CORE_ROLES = ['po', 'qa', 'dev'] as const;
export const OPTIONAL_ROLES = ['sec', 'arch'] as const;
export type GovernanceRole = (typeof CORE_ROLES)[number] | (typeof OPTIONAL_ROLES)[number];
export type CoreRole = (typeof CORE_ROLES)[number];

export const GOVERNANCE_LABEL = 'governance';
export const GOVERNANCE_TITLE = 'Project Governance';
export const ROLES_HEADING = '## Roles';
export const FLAGS_HEADING = '## Flags';

/** projectKey from an issue key: `PROJ-123` → `PROJ`. */
export function deriveProjectKey(issueKey: string): string {
  const m = /^([A-Z][A-Z0-9_]+)-\d+$/.exec(issueKey);
  if (!m) throw new Error(`Cannot derive project key from "${issueKey}"`);
  return m[1]!;
}

function parseRoles(text: string): GovernanceRoles {
  const body = text.replace(/## Flags[\s\S]*$/s, '');
  const roles: GovernanceRoles = {};
  for (const m of body.matchAll(/^\s*(po|qa|dev|sec|arch):\s*(\S+)\s*$/gm)) {
    roles[m[1] as GovernanceRole] = m[2] as string;
  }
  return roles;
}

function parseFlags(text: string): GovernanceFlags {
  const section = text.includes(FLAGS_HEADING) ? text.slice(text.indexOf(FLAGS_HEADING)) : '';
  const body = section.replace(/Edit these lines[\s\S]*$/s, '');
  const off = (k: string): boolean => new RegExp(`\\b${k}:\\s*off\\b`).test(body);
  // opt-out: default on; only an explicit "off" disables a role.
  return { sec: !off('sec'), arch: !off('arch') };
}

function governanceDoc(roles: GovernanceRoles, flags: GovernanceFlags): AdfNode {
  const roleLines = [...CORE_ROLES, ...OPTIONAL_ROLES].map(k => `${k}: ${roles[k] ?? ''}`);
  const flagLines = OPTIONAL_ROLES.map(k => `${k}: ${flags[k] ? 'on' : 'off'}`);
  return doc(
    para({ t: ROLES_HEADING, b: true }),
    codeBlock(roleLines.join('\n') + '\n'),
    para({ t: FLAGS_HEADING, b: true }),
    codeBlock(flagLines.join('\n') + '\n'),
    para('Edit these lines to split responsibilities; opts default to on and default to the project lead.'),
  );
}

/** Find the repo-project governance ticket (label `governance`). */
async function findGovernanceTicket(jira: JiraClient, projectKey: string): Promise<string | null> {
  const issues = await jira.searchJql(`project = ${projectKey} AND labels = ${GOVERNANCE_LABEL}`, ['key']);
  const hit = issues.find(it => (it as any).key);
  return hit ? (hit as any).key as string : null;
}

/** Create the per-project governance ticket once (idempotent by label+title). */
export async function ensureGovernanceTicket(
  jira: JiraClient,
  input: { projectKey: string; leadAccountId: string },
): Promise<string> {
  const existing = await findGovernanceTicket(jira, input.projectKey);
  if (existing) return existing;
  const roles: GovernanceRoles = { po: input.leadAccountId, qa: input.leadAccountId, dev: input.leadAccountId, sec: input.leadAccountId, arch: input.leadAccountId };
  const flags: GovernanceFlags = { sec: true, arch: true };
  const created = await jira.createIssue({
    project: { key: input.projectKey },
    issuetype: { id: '10008' }, // Task
    summary: GOVERNANCE_TITLE,
    description: governanceDoc(roles, flags),
    labels: [GOVERNANCE_LABEL],
  });
  return created.key;
}

async function readGovernanceTicket(jira: JiraClient, projectKey: string): Promise<{ key: string | null; lead: string }> {
  const key = await findGovernanceTicket(jira, projectKey);
  let lead = '';
  try {
    lead = (await jira.getProject(projectKey)).lead?.accountId ?? '';
  } catch {
    /* default empty */
  }
  return { key, lead };
}

/** Load the role map + flags. Missing ticket → all roles = project lead; flags default on. */
export async function readConfig(jira: JiraClient, projectKey: string): Promise<GovernanceConfig> {
  const { key, lead } = await readGovernanceTicket(jira, projectKey);
  if (!key) {
    return { roles: { po: lead || undefined, qa: lead || undefined, dev: lead || undefined, sec: lead || undefined, arch: lead || undefined }, flags: { sec: true, arch: true } };
  }
  const issue = await jira.getIssue(key, ['description']);
  const text = adfToPlainText((issue as { fields?: { description?: unknown } }).fields?.description);
  const roles = parseRoles(text);
  return { roles, flags: parseFlags(text) };
}

/** Load only the role map (legacy callers). */
export async function readRoles(jira: JiraClient, projectKey: string): Promise<GovernanceRoles> {
  const { roles } = await readConfig(jira, projectKey);
  return roles;
}

export interface AssignResult {
  assigned: boolean;
  accountId?: string;
  /** true when a sec/arch concern was routed to DEV because its flag is off. */
  downgradedToDev?: boolean;
}

/**
 * Assign the role-owner before a proposal gate (assign-on-propose).
 * sec/arch: when the role flag is OFF, fall back to the DEV owner (note is added
 * by the caller) rather than silently dropping oversight.
 */
export async function assignRoleApprover(
  jira: JiraClient,
  issueKey: string,
  role: GovernanceRole,
): Promise<AssignResult> {
  const projectKey = deriveProjectKey(issueKey);
  const config = await readConfig(jira, projectKey);
  let accountId = config.roles[role];
  let downgradedToDev = false;

  if ((role === 'sec' || role === 'arch') && !config.flags[role]) {
    accountId = config.roles.dev;
    downgradedToDev = true;
  }
  if (accountId) await jira.assign(issueKey, accountId);
  return { assigned: Boolean(accountId), accountId, downgradedToDev };
}
