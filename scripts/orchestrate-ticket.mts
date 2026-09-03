/**
 * aialm-oss-orchestrate — single-ticket advance one step (agentowy klej).
 * Użycie: npm run orchestrate:ticket -- WELLBEINGT-N
 *         npm run orchestrate:ticket -- WELLBEINGT-5
 *
 * Jeden krok = jedno legalne przesunięcie kolumny (transition STAGE).
 * Jeśli nie można przesunąć → zostawia komentarz BLOCKED na tickecie.
 * Wariant I — exclusive mutator: nie duplikuje pracy skilli.
 */
import { JiraClient } from '../src/aialm/oss/adapter/jira.js';
import { loadDotEnv, jiraConfig } from '../src/aialm/oss/adapter/config.js';
import { advanceOne, logDebugForRow } from '../src/aialm/oss/orchestrate/index.js';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.js';
import { markdownToAdf } from '../src/aialm/oss/adapter/adf.js';

loadDotEnv(process.cwd());

const ticketKey = process.argv[2];
if (!ticketKey || !/^[A-Z][A-Z0-9_]+-\d+$/.test(ticketKey)) {
  console.error('usage: npm run orchestrate:ticket -- <WELLBEINGT-N>');
  console.error('  np. npm run orchestrate:ticket -- WELLBEINGT-5');
  process.exit(1);
}

const projectKey = ticketKey.split('-')[0]!;
const jira = new JiraClient({ config: jiraConfig() });

try {
  const cids = await ensureSelfAwareFields(jira, projectKey);
  const row = await advanceOne(jira, ticketKey, { cids });

  console.log(`[${row.result}] ${row.key} (${row.status} | ${row.state})${row.detail ? ` — ${row.detail}` : ''}`);

  // Per-ticket DEBUG governance flaga — default ON (brak labela = on).
  // Gdy DEBUG on → log KAŻDEJ czynności jako komentarz DEBUG (wszystkie wyniki).
  // Gdy DEBUG off → zachowaj dotychczasowe BLOCKED tylko dla nie-zaawansowanych.
  const debugLogged = await logDebugForRow(jira, row);
  if (debugLogged) {
    console.log(`  → zostawiono komentarz DEBUG na ${ticketKey}`);
  } else {
    // DEBUG off — legacy BLOCKED per AGENTS.md
    if (row.result === 'PICKUP_OK') {
      // PICKUP_OK już przestawił krotkę — nie komentujemy gdy DEBUG off
    } else if (row.result === 'ERROR') {
      await jira.addComment(ticketKey, markdownToAdf(`[AI-generated] Orchestrate — ${ticketKey} — BLOCKED: ${row.detail ?? 'unknown error'}`));
      console.log(`  → zostawiono komentarz BLOCKED na ${ticketKey}`);
    } else {
      const reason =
        row.result === 'NO_APPROVAL'
          ? 'brak ludzkiej aprobaty (✅/APPROVE:<id>)'
          : row.result === 'OUT_OF_SCOPE'
            ? `ticket poza zakresem: ${row.detail}`
            : `poza bramką: ${row.detail}`;
      await jira.addComment(ticketKey, markdownToAdf(`[AI-generated] Orchestrate — ${ticketKey} — BLOCKED: ${reason}\n\nStan: ${row.status} | ${row.state}`));
      console.log(`  → zostawiono komentarz BLOCKED na ${ticketKey}: ${reason}`);
    }
  }
} catch (e) {
  console.error('orchestrate:ticket failed:', (e as Error).message);
  process.exit(1);
}
