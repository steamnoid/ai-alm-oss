/**
 * aialm-oss-discover — CLI.
 * Użycie: npm run discover -- <owner/repo> <projectKey>
 * Wymaga .env z JIRA_SITE/JIRA_EMAIL/JIRA_TOKEN (+ GITHUB_TOKEN opcjonalnie).
 */
import { JiraClient } from '../src/aialm/oss/adapter/jira.js';
import { GithubClient } from '../src/aialm/oss/adapter/github.js';
import { loadDotEnv } from '../src/aialm/oss/adapter/config.js';
import { runDiscover } from '../src/aialm/oss/discover/index.js';

loadDotEnv(process.cwd());

const repoArg = process.argv[2];
const projectKey = process.argv[3];
if (!repoArg || !repoArg.includes('/') || !projectKey) {
  console.error('usage: npm run discover -- <owner/repo> <projectKey>');
  process.exit(1);
}
const [owner, repo] = repoArg.split('/') as [string, string];

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
  const res = await runDiscover(jira, gh, { owner, repo, projectKey });
  console.log(`\nDiscover ${owner}/${repo} → ${res.projectKey}`);
  console.log('  CREATED:');
  if (!res.persist.created.length) console.log('    (none)');
  for (const c of res.persist.created) console.log(`    ${c.ref} → ${c.key}`);
  console.log('  SKIPPED:');
  if (!res.persist.skipped.length) console.log('    (none)');
  for (const s of res.persist.skipped) console.log(`    ${s.ref} (${s.reason})`);
  console.log('  SUMMARY:');
  for (const k of ['READY', 'NEEDS-CLARIFICATION', 'BLOCKED', 'UNSUITABLE'] as const) {
    const s = res.summary[k];
    if (s && (s.created || s.skipped)) console.log(`    ${k}: created=${s.created} skipped=${s.skipped}`);
  }
} catch (e) {
  console.error('discover failed:', (e as Error).message);
  process.exit(1);
}