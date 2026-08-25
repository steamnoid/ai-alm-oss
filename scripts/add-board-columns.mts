import { chromium } from 'playwright';

const SITE = 'https://ai-alm-oss.atlassian.net';
const PROJECT_ID = '10103';

const STATUSES = [
  { name: 'Candidates Pool', statusCategory: 'TODO' },
  { name: 'Agent Working (PO Analyst)', statusCategory: 'IN_PROGRESS' },
  { name: 'Awaiting Approval (PO)', statusCategory: 'TODO' },
  { name: 'Agent Working (QA Analyst)', statusCategory: 'IN_PROGRESS' },
  { name: 'Awaiting Approval (QA)', statusCategory: 'TODO' },
  { name: 'Agent Working (ARCH Analyst)', statusCategory: 'IN_PROGRESS' },
  { name: 'Awaiting Approval (ARCH)', statusCategory: 'TODO' },
  { name: 'Agent Working (SEC Analyst)', statusCategory: 'IN_PROGRESS' },
  { name: 'Awaiting Approval (SEC)', statusCategory: 'TODO' },
  { name: 'Agent Working (DEV Analyst)', statusCategory: 'IN_PROGRESS' },
  { name: 'Awaiting Approval (DEV)', statusCategory: 'TODO' },
  { name: 'Agent Working (QA Impl)', statusCategory: 'IN_PROGRESS' },
  { name: 'Agent Working (DEV Impl)', statusCategory: 'IN_PROGRESS' },
  { name: 'Agent Working (Verify)', statusCategory: 'IN_PROGRESS' },
  { name: 'Agent Working (PR)', statusCategory: 'IN_PROGRESS' },
];

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // User logs in manually
  await page.goto(`${SITE}/secure/Dashboard.jspa`);
  console.log('→ Waiting for Jira login...');
  await page.waitForURL('**/secure/Dashboard.jspa**', { timeout: 120_000 });
  console.log('✓ Logged in');

  // Use page.request — shares browser session cookies/auth
  console.log('→ Creating statuses via authenticated page.request...');
  const res = await page.request.post(`${SITE}/rest/api/3/statuses`, {
    data: {
      scope: { type: 'PROJECT', project: PROJECT_ID },
      statuses: STATUSES,
    },
    headers: { 'Content-Type': 'application/json' },
  });

  const body = await res.text();
  console.log(`Status: ${res.status()}`);
  console.log('Response:', body.slice(0, 600));

  if (res.ok()) {
    console.log('✅ All statuses created!');
    // Navigate to board to see them
    await page.goto(`${SITE}/jira/software/c/projects/WELLBEINGT/boards`);
    await page.waitForTimeout(3000);
  } else {
    await page.screenshot({ path: '/tmp/jira-debug.png', fullPage: true });
    console.log('📸 Screenshot saved');
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
