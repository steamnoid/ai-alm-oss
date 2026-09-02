import { describe, it, expect } from 'vitest';
import { JiraClient, testConfig } from '../../src/aialm/oss/adapter/jira.js';
import {
  advanceOne,
  candidateApproved,
  inferGate,
  isInBacklog,
  runOnce,
} from '../../src/aialm/oss/orchestrate/index.js';
import type { SelfAwareCids } from '../../src/aialm/oss/adapter/fields-config.js';
import type { CommentLike, Reaction } from '../../src/aialm/oss/shared/approval.js';

const CIDS: SelfAwareCids = { stage: 'customfield_10090', role: 'customfield_10091', agent: 'customfield_10092' };

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Factory for a fetch seam; handler url matches by exact pathname suffix. */
function makeJira(
  handlers: Array<{ url: string; fn: (u: URL, init?: RequestInit) => Response | Promise<Response> }>,
): JiraClient {
  const fetchImpl = async (u: unknown, init?: unknown): Promise<Response> => {
    const url = new URL(String(u));
    const path = url.pathname;
    for (const h of handlers) {
      if (path === h.url || path.endsWith(h.url)) return h.fn(url, init as RequestInit);
    }
    throw new Error(`unexpected call: ${path}`);
  };
  return new JiraClient({ config: testConfig('https://t.atlassian.net'), fetchImpl: fetchImpl as typeof fetch });
}

const SELF_AWARE_FIELDS_RESPONSE = [
  { id: 'customfield_10090', name: 'AIALM STAGE', custom: true },
  { id: 'customfield_10091', name: 'AIALM ROLE', custom: true },
  { id: 'customfield_10092', name: 'AIALM AGENT', custom: true },
];

function selfAwareHandlers(): Array<{ url: string; fn: (u: URL, i?: RequestInit) => Response }> {
  return [
    { url: '/field', fn: () => json(SELF_AWARE_FIELDS_RESPONSE) },
    { url: '/tabs', fn: () => json([{ id: 'tab1', name: 'Field Tab' }]) },
    { url: '/screens', fn: () => json({ values: [{ id: '2', name: 'C: Kanban Default Issue Screen' }], isLast: true }) },
    // context of a field
    { url: '/context', fn: () => json({ values: [{ id: 'ctx1', isGlobalContext: true }] }) },
    // context options (GET lists; POST creates)
    {
      url: '/option',
      fn: (u, init) => {
        const method = (init?.method ?? 'GET') as string;
        return method === 'GET' ? json({ values: [] }) : json({ options: [{ id: 'opt1', value: 'IDLE' }] });
      },
    },
    { url: '/myself', fn: () => json({ accountId: 'ai-bot', emailAddress: 'aialmoss@icloud.com' }) },
  ];
}

const commentLike = (body: string | null, isAi: boolean, reactions: Reaction[] = []): CommentLike => ({
  body,
  isAi,
  reactions,
});

describe('orchestrate — pure helpers', () => {
  it('inferGate: READY/AWAITING_HUMAN_APPROVAL + PO + agent none (custom fields, not labels)', () => {
    expect(inferGate({ stage: 'READY', role: 'PO', agent: 'none' })).toBe(true);
    expect(inferGate({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'PO', agent: 'none' })).toBe(true);
    expect(inferGate({ stage: 'READY', role: 'QA', agent: 'none' })).toBe(false);
    expect(inferGate({ stage: 'READY', role: null, agent: 'none' })).toBe(false);
    expect(inferGate({ stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent: 'aialm-oss-po-analyze' })).toBe(false);
    expect(inferGate({ stage: 'IDLE', role: null, agent: 'none' })).toBe(false);
  });

  it('isInBacklog matches native status Backlog case-insensitively', () => {
    expect(isInBacklog({ status: { name: 'Backlog' } })).toBe(true);
    expect(isInBacklog({ status: { name: 'backlog' } })).toBe(true);
    expect(isInBacklog({ status: { name: 'Selected for dev' } })).toBe(false);
    expect(isInBacklog({})).toBe(false);
  });

  it('candidateApproved honours human ✅ and ignores AI-only reactions', () => {
    expect(candidateApproved([commentLike(null, false, [{ emoji: '✅', isAi: false }])])).toBe(true);
    expect(candidateApproved([commentLike('hello', false, [{ emoji: '👍', isAi: true }])])).toBe(false);
    expect(candidateApproved([commentLike('APPROVE', false)])).toBe(true);
    expect(candidateApproved([commentLike('Looks good', false)])).toBe(true);
    expect(candidateApproved([commentLike('✅ Looks good!', false)])).toBe(true);
    expect(candidateApproved([commentLike(null, true, [{ emoji: '✅', isAi: true }])])).toBe(false);
  });
});

describe('orchestrate — advanceOne', () => {
  it('PICKUP_OK: READY + PO w Backlogu + ✅ → pickup, drop candidate, native transition', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' }, labels: ['candidate'] } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'human-1' }, body: 'Looks good', reactions: [{ emoji: '👍', author: { accountId: 'human-1' } }] }] }) },
      { url: '/statuses', fn: () => json([{ statuses: [{ name: 'AWAITS AGENT PICKUP' }] }]) },
      { url: '/transitions', fn: () => json({ transitions: [{ id: '11', to: { name: 'AWAITS AGENT PICKUP' } }] }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS, targetColumn: 'AWAITS AGENT PICKUP', statuses: ['AWAITS AGENT PICKUP'] });
    expect(row.result).toBe('PICKUP_OK');
  });

  it('OUT_OF_SCOPE: READY ale nie w Backlogu', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Selected for dev' } } }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS, targetColumn: 'AWAITS AGENT PICKUP', statuses: [] });
    expect(row.result).toBe('OUT_OF_SCOPE');
    expect(row.detail).toContain('Backlog');
    expect(row.status).toBe('Selected for dev');
    expect(row.state).toBe('READY/PO/none');
  });

  it('MISSING_COLUMN: zwrotka gdy kolumna nie istnieje (po updateState + drop candidate)', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' }, labels: ['candidate'] } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'human-1' }, body: 'approve', reactions: [] }] }) },
      { url: '/statuses', fn: () => json([{ statuses: [{ name: 'To Do' }] }]) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS, targetColumn: 'AWAITS AGENT PICKUP', statuses: ['To Do'] });
    expect(row.result).toBe('MISSING_COLUMN');
    expect(row.detail).toContain('AWAITS AGENT PICKUP');
  });

  it('NO_APPROVAL: READY w Backlogu, ale brak ludzkiej akceptacji', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'ai-bot' }, body: '[AI-generated] Proposal — C-1 — aialm-oss-po-analyze:abc', reactions: [] }] }) },
      { url: '/statuses', fn: () => json([{ statuses: [{ name: 'AWAITS AGENT PICKUP' }] }]) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS, targetColumn: 'AWAITS AGENT PICKUP', statuses: ['AWAITS AGENT PICKUP'] });
    expect(row.result).toBe('NO_APPROVAL');
  });

  it('NOT_CANDIDATE: STAGE != READY/AWAITING_HUMAN_APPROVAL (np. IDLE)', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'IDLE' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS, targetColumn: 'AWAITS AGENT PICKUP', statuses: [] });
    expect(row.result).toBe('NOT_CANDIDATE');
    expect(row.status).toBe('Backlog');
    expect(row.state).toBe('IDLE/PO/none');
  });

  it('NOT_CANDIDATE: role != PO', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'QA' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS, targetColumn: 'AWAITS AGENT PICKUP', statuses: [] });
    expect(row.result).toBe('NOT_CANDIDATE');
  });

  it('zwrotka zawiera native status i zwartą krotkę state dla wszystkich wyników', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'human-1' }, body: 'approve', reactions: [] }] }) },
      { url: '/statuses', fn: () => json([{ statuses: [{ name: 'AWAITS AGENT PICKUP' }] }]) },
      { url: '/transitions', fn: () => json({ transitions: [{ id: '11', to: { name: 'AWAITS AGENT PICKUP' } }] }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS, targetColumn: 'AWAITS AGENT PICKUP', statuses: ['AWAITS AGENT PICKUP'] });
    expect(row.result).toBe('PICKUP_OK');
    expect(row.status).toBe('Backlog');
    expect(row.state).toBe('READY/PO/none');
    expect(row.detail).toContain('pickup');
  });
});

describe('orchestrate — runOnce', () => {
  it('scans each provided project and finds pending candidates', async () => {
    const calls: string[] = [];
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/search/jql', fn: () => { calls.push('search'); return json({ issues: [] }); } },
      { url: '/statuses', fn: () => json([{ statuses: [] }]) },
    ]);
    const reports = await runOnce(jira, ['C'], {});
    expect(reports).toHaveLength(1);
    expect(reports[0]!.projectKey).toBe('C');
    expect(reports[0]!.rows).toEqual([]);
    expect(calls).toContain('search');
  });

  it('zwrotka zawiera WSZYSTKIE tickety (kandydaci + nie-kandydaci) ze statusem i powodem', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/search/jql', fn: () => json({ issues: [{ key: 'C-1' }, { key: 'C-2' }] }) },
      // C-1: gate OK, w Backlogu, brak approval → NO_APPROVAL
      // C-2: IDLE/none — nie kandydat
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'ai-bot' }, body: '[AI-generated] Proposal — C-1', reactions: [] }] }) },
      { url: '/issue/C-2', fn: () => json({ fields: { customfield_10090: { value: 'IDLE' }, customfield_10091: null, customfield_10092: { value: 'none' }, status: { name: 'In Progress' } } }) },
      { url: '/statuses', fn: () => json([{ statuses: [{ name: 'AWAITS AGENT PICKUP' }] }]) },
    ]);
    const reports = await runOnce(jira, ['C'], {});
    expect(reports[0]!.rows).toHaveLength(2);
    const byKey = Object.fromEntries(reports[0]!.rows.map(r => [r.key, r]));
    expect(byKey['C-1']!.result).toBe('NO_APPROVAL');
    expect(byKey['C-1']!.status).toBe('Backlog');
    expect(byKey['C-1']!.state).toBe('READY/PO/none');
    expect(byKey['C-2']!.result).toBe('NOT_CANDIDATE');
    expect(byKey['C-2']!.status).toBe('In Progress');
  });

  it('reports ERROR per-project when provisioning fails', async () => {
    const jira = makeJira([
      { url: '/field', fn: () => json(SELF_AWARE_FIELDS_RESPONSE) },
      { url: '/tabs', fn: () => json([{ id: 'tab1', name: 'Field Tab' }]) },
      { url: '/screens', fn: () => json({ values: [], isLast: true }) },
      { url: '/context', fn: () => json({ values: [{ id: 'ctx1', isGlobalContext: true }] }) },
      { url: '/option', fn: () => json({ values: [] }) },
      { url: '/myself', fn: () => json({ accountId: 'ai-bot', emailAddress: 'aialmoss@icloud.com' }) },
    ]);
    const reports = await runOnce(jira, ['C'], {});
    expect(reports[0]!.rows[0]!.result).toBe('ERROR');
  });
});