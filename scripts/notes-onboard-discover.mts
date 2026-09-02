/**
 * Persist "reimplementation notes" subtickets in the AAO metaproject.
 *
 * Wnioski NIEPOZOSTAWIONE w spec (AAO-30/31) — kruczki, które poznaliśmy dopiero
 * przy LIVE implementacji onboard + discover. Celem jest umożliwienie
 * re-implementacji na bazie ticketów, bez czytania kodu.
 *
 * Tworzy (idempotentnie po label+title):
 *   - AAO-30 (onboard)  → "reimplementation notes — onboard"
 *   - AAO-31 (discover) → "reimplementation notes — discover"
 *
 * Użycie: npm run notes
 */
import { markdownToAdf } from '../src/aialm/oss/adapter/adf.js';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.js';
import { JiraClient } from '../src/aialm/oss/adapter/jira.js';

loadDotEnv(process.cwd());

const NOTES_LABEL = 'reimplementation-notes';

const NOTES: ReadonlyArray<{ parent: string; title: string; body: string }> = [
  {
    parent: 'AAO-30',
    title: 'reimplementation notes — onboard',
    body: [
      '## Re-implementation notes — onboard (kruczki z live impl)',
      '',
      'Backend: Jira Cloud REST v3. Tylko konto AI ALM OSS (aialmoss@icloud.com). NIGDY Plane.',
      '',
      '- **Company-managed template to warunek.** Użyj `com.pyxis.greenhopper.jira:gh-kanban-template` '
        + '(classic), NIE `gh-simplified-*` (next-gen). Screens team-managed NIE są sterowane przez REST '
        + '→ pola self-aware nie są settable (500 przy update).',
      '- Self-aware pola tworzone **per-klient** (label `AIALM STAGE/ROLE/AGENT`, select) i podpinane do '
        + 'screenów projektu klienta (prefix nazwy `<KEY>:`). W metaprojekcie AAO tych pól NIE ma.',
      '- `ProfileCollector` zbiera commands z GitHub Actions; gdy brak workflow — fallback do `package.json` '
        + 'scripts (`npm run typecheck/test/build`). Każde pole MISSING jest jawne (never invented).',
      '- Governance: przy pierwszym onboardzie wszystkie ROLE = lead accountId; Flags `sec`/`arch` domyślnie `on`.',
      '- Idempotencja: provision reuse po kluczu projektu; governance/profile po label+title.',
      '- DELETE projektu Jira uwalnia nazwę/klucz asynchronicznie (~3 min purge); restacje po kasowaniu są '
        + 'nieadresowalne (zombie screens).',
    ].join('\n'),
  },
  {
    parent: 'AAO-31',
    title: 'reimplementation notes — discover',
    body: [
      '## Re-implementation notes — discover (kruczki z live impl)',
      '',
      'Backend: Jira Cloud REST v3. Kandydat trafia do projektu KLIENTA (nie AAO).',
      '',
      '- **Ten sam warunek company-managed co onboard** — persist kandydatów zależy od settable screens. '
        + '`gh-kanban-template` (classic), never next-gen.',
      '- **`ensureSelfAwareFields` idempotentny 3-warstwowo:** (1) create-or-find pola, (2) DODAJ TYLKO '
        + 'BRAKUJĄCE opcje — Jira zwraca 400 na duplikat option, (3) wire pola do screenów klienta. '
        + 'Rozwiązane CIDs są używane do `updateState`.',
      '- **search/jql**: nowy `/rest/api/3/search/jql` (stary `/search` usunięty w tej instancji) zwraca '
        + 'TYLKO `id` gdy nie żądasz pól. Podaj `fields` by dostać `key`+`fields`+`description` — inaczej '
        + 'idempotencja `aialm-external:` nie zadziała.',
      '- **Eventual-consistency**: zaraz po `createIssue`, `updateState` (PUT) potrafi zwrócić transient 404 '
        + '— potrzebny retry z backoffem (5 prób, ~300ms*próba).',
      '- **Label-sync** (w `updateState`): utrzymuje `aialm:stage:*` + `aialm:role:*` (prefiks globalnie '
        + 'bezpieczny), ZACHOWUJE obce (candidate/recommendation), usuwa przeterminowane `aialm:*`. Filtrowanie: '
        + '`labels = "aialm:stage:awaiting-human-approval"`. AGENT celowo NIE jest labelem (cardinality).',
      '- Kandydat: `STAGE=AWAITING_HUMAN_APPROVAL / ROLE=PO / AGENT=none` + native `To Do` + label '
        + '`candidate`+recommendation. `BLOCKED` to label rekomendacji, NIGDY nie stan.',
      '- `listOpenIssues` skip PR, paginacja (duże repo → setki kandydatów).',
    ].join('\n'),
  },
];

async function ensureNotes(jira: JiraClient, note: (typeof NOTES)[number]): Promise<{ key: string; created: boolean }> {
  const marker = `aialm-notes: ${note.parent}:${note.title}`;
  // Idempotencja po stabilnym markerze (nie po `summary ~ "…—…"` — em-dash łamie
  // tokenizację JQL full-text). Marker jest w description i wyciągany regexem.
  const existing = await jira.searchJql(
    `project = AAO AND labels = ${NOTES_LABEL}`,
    ['description'],
  );
  for (const it of existing) {
    const desc = (it.fields as { description?: unknown } | undefined)?.description;
    if (JSON.stringify(desc ?? '').includes(marker)) {
      return { key: it.key as string, created: false };
    }
  }
  const issue = await jira.createIssue({
    project: { key: 'AAO' },
    parent: { key: note.parent },
    issuetype: { id: await jira.issueTypeId('AAO', 'Story') },
    summary: note.title,
    description: markdownToAdf(`${note.body}\n\n${marker}`),
    labels: [NOTES_LABEL, 'V1'],
  });
  return { key: issue.key, created: true };
}

const jira = new JiraClient({ config: jiraConfig() });
try {
  for (const note of NOTES) {
    const r = await ensureNotes(jira, note);
    console.log(`${r.created ? 'CREATED ' : 'EXISTS  '} ${r.key}  ${note.title}  (parent ${note.parent})`);
  }
} catch (e) {
  console.error('notes failed:', (e as Error).message);
  process.exit(1);
}