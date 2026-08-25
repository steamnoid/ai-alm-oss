import type { JiraClient } from '../alm/jira.ts';
import type { GithubClient } from '../github/github.ts';
import { type AdfNode, bullets, codeBlock, doc, heading, para } from '../alm/adf.ts';
import { provisionRepoProject } from './provision.ts';
import { ProfileCollector } from './profile.ts';
import { ensureGovernanceTicket } from '../governance/roles.ts';
import type { ProjectAiProfile } from '../shared/models.ts';

export interface OnboardResult {
  projectKey: string;
  created: boolean;
  governanceKey: string;
  profileIssueKey: string;
  profile: ProjectAiProfile;
}

function listOrMissing(items: string[], label: string): AdfNode {
  if (!items.length) return para({ t: `${label}: ` }, { t: 'MISSING', c: true });
  return bullets(items.map(v => [{ t: label, b: true }, { t: ' ' + v }]));
}
function orMissing(v: string | undefined, label: string): AdfNode {
  return v ? para({ t: `${label}: ` }, { t: v, c: true }) : para({ t: `${label}: ` }, { t: 'MISSING', c: true });
}

export function renderProfile(p: ProjectAiProfile): AdfNode {
  return doc(
    heading(1, 'Project AI Profile'),
    para({ t: 'repo: ' }, { t: p.repo, c: true }),
    orMissing(p.defaultBranch, 'default_branch'),
    bullets(p.languages.map(v => [{ t: 'language:', b: true }, { t: ' ' + v }])),
    para('Contributing:'),
    p.contributing ? codeBlock(p.contributing.slice(0, 8000)) : para({ t: 'MISSING', c: true }),
    listOrMissing(p.issueTemplates, 'issue_templates'),
    para({ t: 'pr_template: ' }, p.prTemplate ? { t: 'present', c: true } : { t: 'MISSING', c: true }),
    para('CI run commands:'),
    p.ciCommands.length ? bullets(p.ciCommands.map(c => [{ t: c, c: true }])) : para({ t: 'MISSING', c: true }),
    para('Restrictions:'),
    p.restrictions.length ? bullets(p.restrictions.map(r => [r])) : para({ t: 'none', c: true }),
  );
}

/**
 * The onboarding "first command": provision the repo's private Jira project,
 * ensure the per-project `Project Governance` ticket (role map, defaults = lead),
 * build the Project AI Profile and seed the Profile issue.
 */
export async function runOnboard(
  jira: JiraClient,
  gh: GithubClient,
  input: { owner: string; repo: string },
): Promise<OnboardResult> {
  const me = await jira.myself();
  const provision = await provisionRepoProject(jira, {
    owner: input.owner,
    repo: input.repo,
    leadAccountId: me.accountId,
  });
  const governanceKey = await ensureGovernanceTicket(jira, {
    projectKey: provision.projectKey,
    leadAccountId: me.accountId,
  });
  const profile = await new ProfileCollector(gh).collect(input.owner, input.repo);
  const profileIssue = await jira.createIssue({
    project: { key: provision.projectKey },
    issuetype: { id: '10008' },
    summary: 'Project AI Profile',
    description: renderProfile(profile),
    labels: ['profile'],
  });
  return {
    projectKey: provision.projectKey,
    created: provision.created,
    governanceKey,
    profileIssueKey: profileIssue.key as string,
    profile,
  };
}
