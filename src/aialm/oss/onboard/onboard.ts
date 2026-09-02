/**
 * aialm-oss-onboard — orchestrator (aialm-oss-project-onboard).
 *
 * Pierwsza komenda na repo: provision prywatnego projektu Jira (per-klient),
 * zapewnienie `Project Governance` + `Project AI Profile`, seed issue profilu.
 */
import type { JiraClient } from '../adapter/jira.js';
import type { GithubClient } from '../adapter/github.js';
import { markdownToAdf } from '../adapter/adf.js';
import { ensureSelfAwareFields, type SelfAwareCids } from '../adapter/fields-config.js';
import { provisionRepoProject } from './provision.js';
import { ensureGovernanceTicket, parseGovernance } from './governance.js';
import { ProfileCollector, type ProjectAiProfile } from './profile.js';

export interface OnboardResult {
  projectKey: string;
  created: boolean;
  governanceKey: string;
  profileIssueKey: string;
  profile: ProjectAiProfile;
  /** Per-klient self-aware field CIDs (AGENTS.md → Wdrożenie). */
  selfAwareCids: SelfAwareCids;
}

const PROFILE_TITLE = 'Project AI Profile';

export async function runOnboard(
  jira: JiraClient,
  gh: GithubClient,
  input: { owner: string; repo: string },
): Promise<OnboardResult> {
  const me = await jira.myself();
  const leadAccountId = me.accountId;

  const provision = await provisionRepoProject(jira, {
    owner: input.owner,
    repo: input.repo,
    leadAccountId,
  });

  // AGENTS.md → Wdrożenie: każdy kliencki projekt ma pola self-aware select.
  const selfAwareCids = await ensureSelfAwareFields(jira, provision.projectKey);

  const governanceKey = await ensureGovernanceTicket(jira, {
    projectKey: provision.projectKey,
    leadAccountId,
  });

  const profile = await new ProfileCollector(gh).collect(input.owner, input.repo);
  const profileKey = await seedProfileIssue(jira, provision.projectKey, profile);

  return {
    projectKey: provision.projectKey,
    created: provision.created,
    governanceKey,
    profileIssueKey: profileKey,
    profile,
    selfAwareCids,
  };
}

/** Ensure the Project AI Profile issue exists (idempotent by title + label profile). */
async function seedProfileIssue(
  jira: JiraClient,
  projectKey: string,
  profile: ProjectAiProfile,
): Promise<string> {
  const existing = await jira.searchJql(
    `project = ${projectKey} AND labels = profile AND summary ~ "${PROFILE_TITLE}"`,
    ['key'],
  );
  if (existing.length) return existing[0]!.key as string;

  const taskTypeId = await jira.issueTypeId(projectKey, 'Task');
  const issue = await jira.createIssue({
    project: { key: projectKey },
    issuetype: { id: taskTypeId },
    summary: PROFILE_TITLE,
    description: markdownToAdf(renderProfileMarkdown(profile)),
    labels: ['profile'],
  });
  return issue.key;
}

export function renderProfileMarkdown(p: ProjectAiProfile): string {
  const lines: string[] = [
    '# Project AI Profile',
    '',
    `repo: \`${p.repo}\``,
    `default_branch: \`${p.defaultBranch ?? 'MISSING'}\``,
    '',
    'languages:',
    ...(p.languages.length ? p.languages.map(l => `- ${l}`) : ['- MISSING']),
    '',
    'issue_templates:',
    ...(p.issueTemplates.length ? p.issueTemplates.map(t => `- ${t}`) : ['- MISSING']),
    '',
    `pr_template: ${p.prTemplate ? 'present' : 'MISSING'}`,
    '',
    'CI:',
    ...(p.hasCi ? ['- workflows present'] : ['- MISSING (no GitHub Actions)']),
    'ci_run_commands:',
    ...(p.ciCommands.length ? p.ciCommands.map(c => `- ${c}`) : ['- MISSING']),
    '',
    'contributing:',
    p.contributing ? String(p.contributing) : '- MISSING',
  ];
  return lines.join('\n');
}

export { parseGovernance };