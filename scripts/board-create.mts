import { JiraClient } from '../src/aialm/oss/alm/jira.ts';
import { jiraBotConfig } from '../src/aialm/oss/shared/config.ts';
import { PROVISION_STATUSES } from '../src/aialm/oss/alm/board.ts';
import { parseProvisionArgs, parseRepoRef, repoKey } from '../src/aialm/oss/board/flags.ts';
import { provisionRepoBoard } from '../src/aialm/oss/board/provision.ts';

/**
 * REST-only board creation for a team-managed pipeline project.
 *
 * Ensures the project exists (name derived from repo: `[AI-ALM] owner/repo`,
 * key derived from repo name) and provisions the 15 role statuses
 * (scope=PROJECT), idempotently. No browser, no session, no 2FA. The governed
 * pipeline drives issues purely by status via REST (`getTransitions`/
 * `transitionIssue`), so this is all it needs.
 *
 * Visual board columns are laid out separately by scripts/board-columns.mts
 * (`board:columns`) and the login session captured by scripts/board-session.mts
 * (`board:session`), because Atlassian only lets you configure columns via UI.
 *
 * Usage:
 *   npx tsx scripts/board-create.mts --repo=steamnoid/wellbeing-tracker-public
 *   npx tsx scripts/board-create.mts --repo=steamnoid/wellbeing-tracker-public --dry
 * env: JIRA_BOT_SITE / JIRA_BOT_EMAIL / JIRA_BOT_TOKEN
 */

async function log(msg: string): Promise<void> {
  console.log(`[board-create] ${msg}`);
}

async function main(): Promise<void> {
  const args = parseProvisionArgs(process.argv.slice(2));
  const site = jiraBotConfig().site;
  await log(`site=${site} repo=${args.repo} dry=${args.dry}`);

  if (!args.repo) throw new Error('--repo=owner/name is required to derive the project');
  const { owner, repo } = parseRepoRef(args.repo);
  const key = repoKey(args.repo);
  const jira = new JiraClient({ config: jiraBotConfig() });

  if (args.dry) {
    const existed = await jira.projectExists(key).catch(() => false);
    await log(`project ${key}: ${existed ? 'exists (reuse)' : 'would create (dry)'}`);
    await log(`name would be [AI-ALM] ${owner}/${repo}`);
    await log(`dry: statuses would be provisioned (${PROVISION_STATUSES.length} names) — no writes`);
    return;
  }

  const me = await jira.myself();
  const r = await provisionRepoBoard(jira, { owner, repo, leadAccountId: me.accountId });
  await log(
    `project ${r.projectKey}: ${r.name} ${r.created ? 'created' : 'exists (reuse)'}` +
      ` | statuses created=${r.statuses.created} skipped=${r.statuses.skipped}` +
      (r.statuses.existing.length ? ` existing=[${r.statuses.existing.join(', ')}]` : ''),
  );
}

main().catch((e) => {
  console.error('[board-create] failed:', e);
  process.exit(1);
});
