import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { JiraClient } from '../src/aialm/oss/alm/jira.ts';
import { jiraBotConfig } from '../src/aialm/oss/shared/config.ts';
import { ROLE_COLUMNS, BOARD_STATUS } from '../src/aialm/oss/alm/board.ts';
import { isOnIdAtlassian, parseColumnsArgs, repoKey } from '../src/aialm/oss/board/flags.ts';
import { boardUrl } from '../src/aialm/oss/board/session.ts';

/**
 * Lay out the board columns for a pipeline project (visual layer only).
 *
 * Loads the captured login session (`.state/jira-session.json`, from
 * `board:session`) and drives the board (Playwright) so the columns mirror the
 * pipeline: add each role status, delete the 3 generic defaults, and move Done
 * last. This is the ONLY way to configure columns — Atlassian provides no REST
 * endpoint for it.
 *
 * No re-authentication here: if the saved session does not reach the board,
 * fail with a clear message pointing at `board:session` (which does login+2FA).
 *
 * Usage:
 *   npx tsx scripts/board-columns.mts --repo=steamnoid/wellbeing-tracker-public
 *   npx tsx scripts/board-columns.mts --repo=steamnoid/wellbeing-tracker-public --dry
 * env: JIRA_BOT_SITE / JIRA_BOT_EMAIL / JIRA_BOT_TOKEN
 */

const DEFAULT_TO_REMOVE = ['To Do', 'In Progress', 'In Review'];
const CHECK_INTERVALS = { short: 400, mid: 800, waitUntilLeavesId: 1200 };

async function log(msg: string): Promise<void> {
  console.log(`[board-columns] ${msg}`);
}

async function openFirstBoard(page: Page, project: string): Promise<number> {
  const jira = new JiraClient({ config: jiraBotConfig() });
  const r = await (jira as unknown as { req: (m: string, p: string) => Promise<{ data: { values?: { id: number }[] } }> }).req(
    'GET',
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}`,
  );
  const boardId = r.data?.values?.length ? r.data.values[0]!.id : null;
  await page.goto(await boardUrl(project, boardId ?? undefined), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  if (isOnIdAtlassian(page.url()) || /join|user-access/i.test(page.url())) {
    throw new Error(
      `session does not reach project "${project}" board (${page.url()}). ` +
        `Run \`board:session --repo=<repo>\` first to re-authenticate.`,
    );
  }
  if (!boardId) throw new Error(`Could not resolve a board id for project "${project}"`);
  await log(`on board id=${boardId}`);
  return boardId;
}

async function columnTitles(page: Page): Promise<string[]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const headers = page.locator('h2[data-testid*="column-title"]');
      if (await headers.count()) return await headers.allInnerTexts();
    } catch {
      // navigation in progress — retry
    }
    await page.waitForTimeout(500);
  }
  return [];
}

/** Fetch the existing column names for a board via REST (source of truth). */
async function fetchColumnNames(project: string, boardId: number): Promise<Set<string>> {
  try {
    const jira = new JiraClient({ config: jiraBotConfig() });
    const r = await (jira as unknown as { req: (m: string, p: string) => Promise<{ data: { columnConfig?: { columns?: { name: string }[] } } }> }).req(
      'GET',
      `/rest/agile/1.0/board/${boardId}/configuration`,
    );
    const names = r.data?.columnConfig?.columns?.map((c) => c.name) ?? [];
    return new Set(names);
  } catch {
    return new Set();
  }
}

async function hasColumn(page: Page, name: string, existing?: Set<string>): Promise<boolean> {
  // Prefer REST as source of truth; fall back to DOM when a set isn't available.
  if (existing) return existing.has(name);
  const titles = await columnTitles(page);
  return titles.some((t) => t.replace(/, total issue count.*$/u, '').trim() === name);
}

async function reloadBoard(page: Page, project: string, boardId: number): Promise<void> {
  await page.goto(await boardUrl(project, boardId), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
}

async function addColumn(page: Page, name: string, project: string, boardId: number, existing: Set<string>): Promise<boolean> {
  if (existing.has(name)) return false;
  const createBtn = page.getByTestId('platform-board-kit.ui.column.column-create.button.styled-button').first();
  await createBtn.scrollIntoViewIfNeeded();
  await createBtn.click();
  await page.waitForTimeout(CHECK_INTERVALS.mid);
  const input = page.getByTestId('platform-board-kit.common.ui.column-header.editable-title.textfield').last();
  await input.waitFor({ timeout: 5000 });
  await input.fill(name);
  await page.waitForTimeout(300);
  const confirm = page.getByRole('button', { name: 'Confirm' }).last();
  try {
    await confirm.click({ timeout: 5000 });
  } catch {
    // Duplicate (already exists) is tolerated: the column is present, just skip.
    existing.add(name);
    return false;
  }
  await page.waitForTimeout(CHECK_INTERVALS.mid);
  existing.add(name);
  return true;
}

async function deleteColumn(page: Page, name: string, key: string, boardId: number, existing: Set<string>): Promise<boolean> {
  if (!(await hasColumn(page, name, existing))) return false;
  const header = page.locator('h2[data-testid*="column-title"]').filter({ hasText: new RegExp(`^${name}(, total|$)`) }).first();
  await header.hover();
  await page.waitForTimeout(300);
  const trigger = page.getByTestId('software-board.board-container.board.column.header.menu.column-menu-trigger').first();
  await trigger.waitFor({ state: 'visible', timeout: 5000 });
  await trigger.click();
  await page.waitForTimeout(CHECK_INTERVALS.mid);
  await page.getByTestId('software-board.board-container.board.column.header.menu.item-delete.dropdown-item').click();
  await page.waitForTimeout(CHECK_INTERVALS.mid);
  // The delete confirmation dialog is identified by its heading ("Move work from
  // X column") — `[role=dialog]` also matches the cookie-consent banner.
  const dialog = page.locator('[role="dialog"]', { hasText: /Move work from/i }).first();
  await dialog.waitFor({ timeout: 5000 });
  const combo = dialog.locator('input[role="combobox"]').first();
  await combo.evaluate((el) => (el as unknown as { focus: () => void }).focus());
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const target = page.locator('[role="option"]').filter({ hasText: /^Candidates Pool$/ }).first();
  await target.click();
  await page.waitForTimeout(CHECK_INTERVALS.mid);
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(CHECK_INTERVALS.mid);
  return true;
}

async function moveColumnRight(page: Page, name: string, project: string, boardId: number, existing?: Set<string>): Promise<number> {
  let moves = 0;
  for (let i = 0; i < 40; i++) {
    if (!(await hasColumn(page, name, existing))) return moves;
    // Column titles render uppercase after a delete; match case-insensitively.
    const header = page
      .locator('h2[data-testid*="column-title"]')
      .filter({ hasText: new RegExp(`^${name}(, total|$)`, 'i') })
      .first();
    await header.hover();
    await page.waitForTimeout(250);
    const trigger = header
      .locator('xpath=ancestor::*[.//button[contains(@data-testid,"column-menu-trigger")]][1]//button[contains(@data-testid,"column-menu-trigger")]')
      .first();
    if (!(await trigger.isVisible().catch(() => false))) return moves;
    await trigger.click();
    await page.waitForTimeout(300);
    const move = page.getByText('Move column right', { exact: true }).first();
    if (!(await move.count()) || (await move.isDisabled().catch(() => false))) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      return moves;
    }
    await move.click();
    await page.waitForTimeout(500);
    moves++;
  }
  await reloadBoard(page, project, boardId);
  return moves;
}

async function dumpColumns(page: Page): Promise<string[]> {
  const titles = await columnTitles(page);
  return titles.map((t) => t.replace(/, total issue count.*$/u, '').trim());
}

async function layoutColumns(page: Page, project: string, boardId: number, existing: Set<string>): Promise<void> {
  for (const col of ROLE_COLUMNS) {
    if (col === BOARD_STATUS.done) continue;
    if (await addColumn(page, col, project, boardId, existing)) await log(`added column: ${col}`);
  }
  for (const name of DEFAULT_TO_REMOVE) {
    if (await deleteColumn(page, name, project, boardId, existing)) await log(`deleted default column: ${name}`);
  }
  const moves = await moveColumnRight(page, BOARD_STATUS.done, project, boardId, existing);
  await log(`moved Done right x${moves}`);
}

async function verifyColumns(page: Page, project: string, boardId: number): Promise<{ ok: boolean; columns: string[] }> {
  await reloadBoard(page, project, boardId);
  const columns = await dumpColumns(page);
  const norm = (s: string) => s.trim().toLowerCase();
  const expected = ROLE_COLUMNS.map(norm);
  const ok = JSON.stringify(columns.map(norm)) === JSON.stringify(expected);
  return { ok, columns };
}

async function main(): Promise<void> {
  const args = parseColumnsArgs(process.argv.slice(2));
  const site = jiraBotConfig().site;
  await log(`site=${site} repo=${args.repo} headless=${args.headless} dry=${args.dry}`);

  if (!args.repo) throw new Error('--repo=owner/name is required to target the project board');
  const project = repoKey(args.repo);

  if (!existsSync(args.session)) {
    throw new Error(
      `session file ${args.session} not found — run \`board:session --repo=${args.repo}\` first to capture the login session.`,
    );
  }

  if (args.dry) {
    await log('dry: would lay out role columns as', ROLE_COLUMNS.join(' → '));
    return;
  }

  const browser: Browser = await chromium.launch({ headless: args.headless });
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    storageState: resolve(args.session),
  });
  const page = await ctx.newPage();
  try {
    const boardId = await openFirstBoard(page, project);
    const existing = await fetchColumnNames(project, boardId);
    await layoutColumns(page, project, boardId, existing);
    const { ok, columns } = await verifyColumns(page, project, boardId);
    if (ok) {
      await log('VERIFY OK — board columns = pipeline order');
      await log(columns.join(' → '));
    } else {
      await log('VERIFY FAIL — current order differs');
      await log(`got:      ${columns.join(' → ')}`);
      await log(`expected: ${ROLE_COLUMNS.join(' → ')}`);
      process.exitCode = 1;
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error('[board-columns] failed:', e);
  process.exit(1);
});
