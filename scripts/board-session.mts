import { jiraBotConfig } from '../src/aialm/oss/shared/config.ts';
import { parseSessionArgs, repoKey } from '../src/aialm/oss/board/flags.ts';
import { captureSessionOnly } from '../src/aialm/oss/board/session.ts';

/**
 * Capture the Atlassian login session for a pipeline project.
 *
 * Logs in (email + password + optional 2FA), navigates to the project's BOARD
 * (so the session covers the space/membership, not just the site home), and if
 * the site shows a "join/user-access" onboarding redirect, accepts it — so the
 * saved session has full access to the space (no later join/user-access bounces).
 * Finally persists cookies + localStorage to `.state/jira-session.json`.
 *
 * Usage:
 *   npx tsx scripts/board-session.mts --repo=steamnoid/wellbeing-tracker-public
 *   npx tsx scripts/board-session.mts --repo=steamnoid/wellbeing-tracker-public --dry
 * env: JIRA_BOT_SITE / JIRA_BOT_EMAIL / JIRA_BOT_TOKEN / JIRA_BOT_PASSWORD
 */

async function log(msg: string): Promise<void> {
  console.log(`[board-session] ${msg}`);
}

async function main(): Promise<void> {
  const args = parseSessionArgs(process.argv.slice(2));
  const site = jiraBotConfig().site;
  await log(`site=${site} repo=${args.repo} headless=${args.headless} dry=${args.dry}`);

  if (!args.repo) throw new Error('--repo=owner/name is required to target the project board');
  if (args.dry) {
    await log(`dry: would capture a session covering project ${repoKey(args.repo)}`);
    return;
  }
  await captureSessionOnly(args.repo, args.session, args.headless);
}

main().catch((e) => {
  console.error('[board-session] failed:', e);
  process.exit(1);
});
