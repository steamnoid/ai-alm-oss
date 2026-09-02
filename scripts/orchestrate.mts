/**
 * aialm-oss-orchestrate — CLI (pojedyncza iteracja — `--once`).
 *
 * Użycie:
 *   npm run orchestrate -- owner/repo [-c "AWAITS AGENT PICKUP"]
 *   npm run orchestrate -- --project WELLBEIN7 [-c "AWAITS AGENT PICKUP"]
 *   npm run orchestrate -- owner/repo --project OTHERKEY [-c "AWAITS AGENT PICKUP"]
 *
 * Projekty przekazywane wprost via `owner/repo` (rozwiązywane do klucza po
 * nazwie `[AI-ALM] owner/repo`) LUB `--project KEY`. Jest uruchamiany przez
 * cron/systemd na zbiorze onboardingowanych projektów.
 */
import { JiraClient } from '../src/aialm/oss/adapter/jira.js';
import { loadDotEnv, jiraConfig } from '../src/aialm/oss/adapter/config.js';
import { runOnce } from '../src/aialm/oss/orchestrate/index.js';
import { projectDisplayName } from '../src/aialm/oss/onboard/key.js';

loadDotEnv(process.cwd());

function value(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** Wszystkie wystąpienia `--project val` (można wiele). */
function collect(name: string): string[] {
  const out: string[] = [];
  let idx = process.argv.indexOf(name);
  while (idx >= 0) {
    const v = process.argv[idx + 1];
    if (v && !v.startsWith('--')) out.push(v);
    idx = process.argv.indexOf(name, idx + 1);
  }
  return out;
}

/** Pozycyjne `owner/repo` (opcje i ich wartości z pomijane). */
function positionalOwnerRepo(): string[] {
  const valueIndexes = new Set<number>();
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--project' || a === '--target-column' || a === '-c') {
      // następny argv to wartość flagi
      if (i + 1 < process.argv.length) valueIndexes.add(i + 1);
    }
  }
  return process.argv
    .slice(2)
    .filter(a => !a.startsWith('--') && !valueIndexes.has(process.argv.indexOf(a)) && a.includes('/'));
}

const targetColumn = value('--target-column') ?? value('-c') ?? 'AWAITS AGENT PICKUP';
const projectKeys = collect('--project');
const repoArgs = positionalOwnerRepo();

/**
 * Rozwiąż `owner/repo` → klucz projektu po NIIZIE `[AI-ALM] owner/repo`
 * (konwencja onboard → projectDisplayName). Nie znaleziono → rzuca.
 */
async function resolveRepoToKey(jira: JiraClient, owner: string, repo: string): Promise<string> {
  const wantedName = projectDisplayName(owner, repo);
  const projects = await jira.listProjects();
  const match = projects.find(p => p.name === wantedName);
  if (!match) throw new Error(`no project named "${wantedName}" (onboard the repo first)`);
  return match.key;
}

const jira = new JiraClient({ config: jiraConfig() });

try {
  const resolved = [...projectKeys];
  for (const arg of repoArgs) {
    const slash = arg.indexOf('/');
    if (slash <= 0 || slash === arg.length - 1) throw new Error(`invalid owner/repo: "${arg}"`);
    const owner = arg.slice(0, slash);
    const repo = arg.slice(slash + 1);
    resolved.push(await resolveRepoToKey(jira, owner, repo));
  }

  if (!resolved.length) {
    console.error('usage: npm run orchestrate -- owner/repo [--project KEY] [-c "AWAITS AGENT PICKUP"]');
    console.error('brak projektów — podaj owner/repo lub --project KEY');
    process.exit(1);
  }

  const reports = await runOnce(jira, resolved, { targetColumn });
  for (const r of reports) {
    console.log(`\n${r.projectKey}:`);
    if (!r.rows.length) console.log('  (brak ticketów w projekcie)');
    for (const row of r.rows) {
      const meta = `${row.status} | ${row.state}`;
      console.log(`  [${row.result}] ${row.key} (${meta})${row.detail ? ` — ${row.detail}` : ''}`);
    }
  }
} catch (e) {
  console.error('orchestrate failed:', (e as Error).message);
  process.exit(1);
}