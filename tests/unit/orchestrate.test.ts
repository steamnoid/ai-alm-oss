import { describe, it, expect } from 'vitest';
import { JiraClient, testConfig } from '../../src/aialm/oss/adapter/jira.js';
import {
  advanceOne,
  candidateApproved,
  inferGate,
  isInBacklog,
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
  it('inferGate: READY/AWAITING_HUMAN_APPROVAL + AI + agent none (custom fields, not labels)', () => {
    expect(inferGate({ stage: 'READY', role: 'AI', agent: 'none' })).toBe(true);
    expect(inferGate({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' })).toBe(true);
    expect(inferGate({ stage: 'READY', role: 'PO', agent: 'none' })).toBe(false);
    expect(inferGate({ stage: 'READY', role: 'QA', agent: 'none' })).toBe(false);
    expect(inferGate({ stage: 'READY', role: null, agent: 'none' })).toBe(false);
    expect(inferGate({ stage: 'AWAITING_AGENT_PICKUP', role: 'AI', agent: 'aialm-oss-po-analyze' })).toBe(false);
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
  it('PICKUP_OK: READY + AI w Backlogu + ✅ → pickup, drop candidate + native AWAITS AGENT PICKUP (atomowo)', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      // transitions must come BEFORE generic /issue/C-1 (endsWith matching)
      { url: '/transitions', fn: (u, init) => (init?.method === 'POST' ? json({}) : json({ transitions: [{ id: '2', name: 'AWAITS AGENT PICKUP', to: { id: '10214', name: 'AWAITS AGENT PICKUP' } }] })) },
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'AI' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' }, labels: ['candidate', 'aialm:stage:ready'] } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'human-1' }, body: 'Looks good', reactions: [{ emoji: '👍', author: { accountId: 'human-1' } }] }] }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS });
    expect(row.result).toBe('PICKUP_OK');
    expect(row.status).toBe('AWAITS AGENT PICKUP');
    expect(row.detail).toContain('AWAITS AGENT PICKUP');
    expect(row.detail).toContain('Backlog →');
  });

  it('OUT_OF_SCOPE: READY ale nie w Backlogu', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'AI' }, customfield_10092: { value: 'none' }, status: { name: 'Selected for dev' } } }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS });
    expect(row.result).toBe('OUT_OF_SCOPE');
    expect(row.detail).toContain('Backlog');
    expect(row.status).toBe('Selected for dev');
    expect(row.state).toBe('READY/AI/none');
  });

  it('NO_APPROVAL: READY w Backlogu, ale brak ludzkiej akceptacji', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'AI' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'ai-bot' }, body: '[AI-generated] Proposal — C-1 — aialm-oss-po-analyze:abc', reactions: [] }] }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS });
    expect(row.result).toBe('NO_APPROVAL');
  });

  it('NOT_CANDIDATE: STAGE != READY/AWAITING_HUMAN_APPROVAL (np. IDLE)', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'IDLE' }, customfield_10091: { value: 'AI' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS });
    expect(row.result).toBe('NOT_CANDIDATE');
    expect(row.status).toBe('Backlog');
    expect(row.state).toBe('IDLE/AI/none');
  });

  it('NOT_CANDIDATE: role != AI (PO/QA nie przechodzi bramki)', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'PO' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS });
    expect(row.result).toBe('NOT_CANDIDATE');
  });

  it('zwrotka zawiera native status i zwartą krotkę state dla wszystkich wyników', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/transitions', fn: (u, init) => (init?.method === 'POST' ? json({}) : json({ transitions: [{ id: '2', name: 'AWAITS AGENT PICKUP', to: { id: '10214', name: 'AWAITS AGENT PICKUP' } }] })) },
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'AI' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'human-1' }, body: 'approve', reactions: [] }] }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS });
    expect(row.result).toBe('PICKUP_OK');
    expect(row.status).toBe('AWAITS AGENT PICKUP');
    expect(row.state).toBe('READY/AI/none');
    expect(row.detail).toContain('pickup');
    expect(row.detail).toContain('AWAITS AGENT PICKUP');
  });

  it('ERROR: brak natywnego transition → rollback krotki', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/transitions', fn: () => json({ transitions: [{ id: '99', name: 'Done', to: { id: '10009', name: 'Done' } }] }) },
      { url: '/issue/C-1', fn: () => json({ fields: { customfield_10090: { value: 'READY' }, customfield_10091: { value: 'AI' }, customfield_10092: { value: 'none' }, status: { name: 'Backlog' } } }) },
      { url: '/comment', fn: () => json({ comments: [{ id: '1', author: { accountId: 'human-1' }, body: 'approve', reactions: [] }] }) },
    ]);
    const row = await advanceOne(jira, 'C-1', { cids: CIDS });
    expect(row.result).toBe('ERROR');
    expect(row.detail).toContain('brak natywnego transition');
  });
});

