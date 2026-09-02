/**
 * aialm-oss-project-onboard — CLI.
 * Użycie: npm run onboard -- owner/repo
 * Wymaga .env z JIRA_SITE/JIRA_EMAIL/JIRA_TOKEN (+ GITHUB_TOKEN).
 */
import { JiraClient } from '../src/aialm/oss/adapter/jira.js';
import { GithubClient } from '../src/aialm/oss/adapter/github.js';
import { loadDotEnv } from '../src/aialm/oss/adapter/config.js';
import { runOnboard } from '../src/aialm/oss/onboard/onboard.js';

loadDotEnv(process.cwd());

const arg = process.argv[2];
if (!arg || !arg.includes('/')) {
  console.error('usage: npm run onboard -- <owner/repo>');
  process.exit(1);
}
const [owner, repo] = arg.split('/') as [string, string];

const site = process.env.JIRA_SITE;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_TOKEN;
if (!site || !email || !token) {
  console.error('Missing JIRA_SITE/JIRA_EMAIL/JIRA_TOKEN in .env');
  process.exit(1);
}

const jira = new JiraClient({ config: { site, email, token } });
const gh = new GithubClient();
try {
  const res = await runOnboard(jira, gh, { owner, repo });
  console.log(
    `\nOnboarded ${owner}/${repo}\n` +
      `  project:      ${res.projectKey} (${res.created ? 'created' : 'reused'})\n` +
      `  governance:   ${res.governanceKey}\n` +
      `  profile:      ${res.profileIssueKey}\n` +
      `  repo:         ${res.profile.repo} @ ${res.profile.defaultBranch}\n` +
      `  hasCi:        ${res.profile.hasCi}\n` +
      `  ciCommands:   ${res.profile.ciCommands.join('; ') || 'MISSING'}`,
  );
} catch (e) {
  console.error('onboard failed:', (e as Error).message);
  process.exit(1);
}