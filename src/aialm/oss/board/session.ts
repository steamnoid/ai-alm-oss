import { createInterface } from 'node:readline/promises';
import {
  stdin as stdinStream,
  stdout as stdoutStream,
} from 'node:process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { jiraBotConfig, jiraBotPassword } from '../shared/config.ts';
import { isBoardUrl, isOnIdAtlassian, repoKey } from './flags.ts';

/**
 * Shared Atlassian session logic for the board scripts.
 *
 * `ensureAuthedSession` returns a browser/ctx/page that is authenticated AND has
 * access to the project's space/board. It reuses a captured `storageState` when
 * it still reaches the board; otherwise it re-authenticates (email+password+2FA,
 * prompting for the authenticator code on stdin) and re-captures the session —
 * so callers never have to deal with an expired session.
 */

export interface AuthedSession {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  authed: boolean;
  persisted: boolean;
}

async function log(msg: string): Promise<void> {
  console.log(`[board-session] ${msg}`);
}

export async function boardUrl(project: string, boardId?: number): Promise<string> {
  const host = new URL(jiraBotConfig().site).host;
  if (boardId) return `https://${host}/jira/software/projects/${project}/boards/${boardId}`;
  return `https://${host}/jira/software/projects/${project}/boards`;
}

/** Accept a "join/user-access" onboarding interstitial so the session covers the space. */
async function handleOnboarding(page: Page, project: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const u = page.url();
    if (isBoardUrl(u)) return;
    if (!isOnIdAtlassian(u)) break;
    const joinBtn = page.getByRole('button', { name: /join|accept|continue|i agree/i }).first();
    if (await joinBtn.count()) await joinBtn.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
}

/** Atlassian may gate a login with a 2-step verification challenge (TOTP). */
async function handleMfaIfPresent(page: Page): Promise<boolean> {
  const mfa = /\/login\/mfa|mfa/i.test(page.url()) && isOnIdAtlassian(page.url());
  if (!mfa) return false;
  await log('2-step verification (authenticator code) required — enter the 6-digit code');
  const otp = process.env.JIRA_BOT_OTP ?? (await promptOtp());
  await page.waitForTimeout(1200);
  const codeInput = page
    .locator('#two-step-verification-otp-code-input, input[name="otpCode"], input[autocomplete="one-time-code"], input[type="text"], input[type="tel"]')
    .filter({ visible: true })
    .first();
  try {
    await codeInput.fill(otp, { timeout: 6000 });
  } catch {
    const snapshot = await page.locator('input').evaluateAll((els) =>
      els.map((e) => ({ id: e.id, name: (e as { name: string }).name, type: (e as { type: string }).type, autocomplete: e.getAttribute('autocomplete'), visible: !!(e.offsetParent) })),
    );
    await log(`could not find the OTP input on ${page.url()} — inputs: ${JSON.stringify(snapshot)}`);
    throw new Error(`OTP input not found on ${page.url()}`);
  }
  await page.waitForTimeout(300);
  const verify = page.locator('button:has-text("Log in"), button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit")').first();
  if (await verify.count()) await verify.click();
  await page.waitForTimeout(2500);
  await log('submitted verification code');
  return true;
}

async function promptOtp(): Promise<string> {
  const rl = createInterface({ input: stdinStream, output: stdoutStream });
  try {
    const code = (await rl.question('Enter the 6-digit code from your authenticator app: ')).trim();
    return code;
  } finally {
    rl.close();
  }
}

async function saveSession(ctx: BrowserContext, sessionPath: string): Promise<void> {
  const p = resolve(sessionPath);
  mkdirSync(dirname(p), { recursive: true });
  await ctx.storageState({ path: p });
  await log(`session saved to ${p}`);
}

/**
 * Ensure we have an authed session that reaches the project board.
 * Reuses the stored session if valid; otherwise re-authenticates (2FA prompt),
 * accepts space onboarding, and persists the new session.
 */
export async function ensureAuthedSession(
  repo: string,
  sessionPath: string,
  headless: boolean,
): Promise<AuthedSession> {
  const site = jiraBotConfig().site;
  const email = jiraBotConfig().email;
  const password = jiraBotPassword();
  const project = repoKey(repo);
  const storageState = existsSync(sessionPath) ? resolve(sessionPath) : undefined;

  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    ...(storageState ? { storageState } : {}),
  });
  const page = await ctx.newPage();

  // Reuse path: if the stored session reaches the project board, we're done.
  await page.goto(await boardUrl(project), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  // On the boards landing page (no board id) we still need to confirm access.
  if (isBoardUrl(page.url())) {
    await log(`reused saved session covering the space (${sessionPath})`);
    return { browser, ctx, page, authed: true, persisted: false };
  }
  if (storageState) await log(`saved session does not reach the board — re-authenticating`);
  if (!password) throw new Error('JIRA_BOT_PASSWORD is required for the Playwright session phase');

  await log(`logging into ${site} as ${email} (headless=${headless})`);
  await page.goto('https://id.atlassian.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const emailInput = page.locator('input[type="email"], input#email').first();
  await emailInput.fill(email);
  await page.waitForTimeout(400);
  const continueBtn = page.locator('button:has-text("Continue"), button#login-submit').first();
  if (await continueBtn.count()) {
    await continueBtn.click();
    await page.waitForTimeout(3500);
  }
  const pwInput = page.locator('input[type="password"], input#password').first();
  await pwInput.fill(password);
  await page.waitForTimeout(300);
  const loginBtn = page.locator('button:has-text("Log in"), button#login-submit').first();
  if (await loginBtn.count()) await loginBtn.click();
  const mfaHandled = await handleMfaIfPresent(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500);
    if (!isOnIdAtlassian(page.url())) break;
  }
  if (mfaHandled && isOnIdAtlassian(page.url())) {
    throw new Error('2FA code was rejected or expired — run again with a fresh code');
  }
  if (isOnIdAtlassian(page.url())) {
    throw new Error('login did not reach the site — check credentials/MFA');
  }

  // Ensure the session covers the space: go to the board, accept onboarding.
  const boardId = await findBoardId(project);
  await page.goto(await boardUrl(project, boardId ?? undefined), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  if (isOnIdAtlassian(page.url()) || /join|user-access/i.test(page.url())) {
    await log('space onboarding requested — accepting');
    await handleOnboarding(page, project);
  }
  const after = page.url();
  if (isOnIdAtlassian(after)) {
    throw new Error(`still on the identity flow after login — ${after}`);
  }

  await saveSession(ctx, sessionPath);
  return { browser, ctx, page, authed: false, persisted: true };
}

async function findBoardId(project: string): Promise<number | null> {
  const { JiraClient } = await import('../alm/jira.ts');
  const jira = new JiraClient({ config: jiraBotConfig() });
  const r = await (jira as unknown as { req: (m: string, p: string) => Promise<{ data: { values?: { id: number }[] } }> }).req(
    'GET',
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}`,
  );
  const values = r.data?.values ?? [];
  return values.length ? values[0]!.id : null;
}

/** Capture only (no layout): ensure session and persist; used by board:session. */
export async function captureSessionOnly(repo: string, sessionPath: string, headless: boolean): Promise<void> {
  const { browser, ctx, page, authed, persisted } = await ensureAuthedSession(repo, sessionPath, headless);
  try {
    if (!authed && !persisted) await saveSession(ctx, sessionPath);
    await log(`session captured (${sessionPath})`);
  } finally {
    await ctx.close();
    await browser.close();
    void page;
  }
}
