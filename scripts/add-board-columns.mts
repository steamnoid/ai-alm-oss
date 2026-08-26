import { chromium } from 'playwright';

const SITE = 'https://ai-alm-oss.atlassian.net';
const PROJECT_ID = '10136'; // WELLBEINGT project id (fresh team-managed)

async function main(): Promise<void> {
  const ctx = await chromium.launchPersistentContext('.playwright-profile', {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();

  // Step 1: Go to Jira dashboard
  console.log('\n🌐 Opening Jira...');
  console.log('👉 LOG IN MANUALLY in the browser window.');
  console.log('⏳ Waiting for you to reach the dashboard (no timeout — take your time)...\n');
  
  await page.goto(`${SITE}/secure/Dashboard.jspa`, { waitUntil: 'domcontentloaded' });

  // Poll until we're actually on the dashboard (logged in)
  for (;;) {
    const url = page.url();
    if (url.includes('/secure/Dashboard') || url.includes('/jira/your-work')) {
      console.log('✓ Logged in! Dashboard detected.');
      break;
    }
    await page.waitForTimeout(2000);
  }

  // Give Jira a moment to fully load
  await page.waitForTimeout(3000);

  // Step 2: Navigate to workflow settings
  console.log('→ Navigating to workflow settings...');
  await page.goto(`https://ai-alm-oss.atlassian.net/jira/settings/projects/WELLBEINGT/workflow`, { waitUntil: 'domcontentloaded' });
  
  // Wait for SPA to render
  await page.waitForTimeout(10_000);
  await page.screenshot({ path: '/tmp/pw-workflow.png', fullPage: true });
  console.log('📸 /tmp/pw-workflow.png');

  // Step 3: Create statuses via page.request (shares browser cookies)
  const statuses = [
    'Candidates Pool',
    'Agent Working (PO Analyst)', 'Awaiting Approval (PO)',
    'Agent Working (QA Analyst)', 'Awaiting Approval (QA)',
    'Agent Working (ARCH Analyst)', 'Awaiting Approval (ARCH)',
    'Agent Working (SEC Analyst)', 'Awaiting Approval (SEC)',
    'Agent Working (DEV Analyst)', 'Awaiting Approval (DEV)',
    'Agent Working (QA Impl)', 'Agent Working (DEV Impl)',
    'Agent Working (Verify)', 'Agent Working (PR)',
  ];

  let ok = 0, fail = 0;
  for (const name of statuses) {
    const category = name.includes('Working') ? 'IN_PROGRESS' : 'TODO';
    try {
      const res = await page.request.post(`${SITE}/rest/api/3/statuses`, {
        data: {
          scope: { type: 'PROJECT', project: '10103' },
          statuses: [{ name, statusCategory: category }],
        },
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.text().catch(() => '');
      if (res.ok()) { ok++; console.log(`  ✓ ${name}`); }
      else { fail++; console.log(`  ✗ ${name}: ${res.status()} ${body.slice(0,80)}`); }
    } catch (e) {
      fail++; console.log(`  ✗ ${name}: ERROR`);
    }
  }
  console.log(`\n✅ ${ok} created, ❌ ${fail} failed.`);

  // Step 4: Keep browser open so user can verify
  console.log('\n→ Browser stays open 60s. Check the board columns!');
  await page.goto(`${SITE}/jira/software/c/projects/WELLBEINGT/boards`);
  await page.waitForTimeout(60_000);
  await ctx.close();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
