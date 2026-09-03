import { describe, it, expect } from 'vitest';
import { JiraClient, testConfig } from '../../src/aialm/oss/adapter/jira.js';
import {
  advanceOne,
  candidateApproved,
  inferGate,
  isInAdvanceSourceStatus,
  isInAwaitingHumanApproval,
  isInBacklog,
  nextAgentAfterApproval,
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

  it('isInAwaitingHumanApproval / isInAdvanceSourceStatus accept Backlog or AWAITS HUMAN APPROVAL', () => {
    expect(isInAwaitingHumanApproval({ status: { name: 'AWAITS HUMAN APPROVAL' } })).toBe(true);
    expect(isInAwaitingHumanApproval({ status: { name: 'awaits human approval' } })).toBe(true);
    expect(isInAdvanceSourceStatus({ status: { name: 'Backlog' } })).toBe(true);
    expect(isInAdvanceSourceStatus({ status: { name: 'AWAITS HUMAN APPROVAL' } })).toBe(true);
    expect(isInAdvanceSourceStatus({ status: { name: 'AGENT WORKING' } })).toBe(false);
  });
});

describe('orchestrate — nextAgentAfterApproval (pickup routing)', () => {
  const poAnalyzeProposal = (id: string) =>
    commentLike(`[AI-generated] Proposal — C-1 — aialm-oss-po-analyze:${id}`, true);
  const humanApprove = commentLike('✅', false);

  it('AWAITING_HUMAN_APPROVAL + po-analyze proposals + generic ✅ → po-prep-decompose (not po-analyze)', () => {
    const comments = [poAnalyzeProposal('6657279bf763'), poAnalyzeProposal('826f84c42a5f'), humanApprove];
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(
      'aialm-oss-po-prep-decompose',
    );
  });

  it('READY + po-analyze proposals + generic ✅ → po-prep-decompose (handles manual READY/AI swap)', () => {
    const comments = [poAnalyzeProposal('abc1234'), humanApprove];
    expect(nextAgentAfterApproval({ stage: 'READY', role: 'AI', agent: 'none' }, comments)).toBe('aialm-oss-po-prep-decompose');
  });

  it('READY discover without po-analyze proposals + ✅ → po-analyze', () => {
    const comments = [humanApprove];
    expect(nextAgentAfterApproval({ stage: 'READY', role: 'AI', agent: 'none' }, comments)).toBe('aialm-oss-po-analyze');
  });

  it('AWAITING_HUMAN_APPROVAL + proposals but no approval → null', () => {
    const comments = [poAnalyzeProposal('abc1234')];
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBeNull();
  });

  it('no comments at all → null', () => {
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, [])).toBeNull();
  });

  it('pickup table linear: po-prep-decompose proposal + APPROVE:id → po-decompose', () => {
    const comments = [
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-prep-decompose:872f6f02bbca', true),
      commentLike('APPROVE:872f6f02bbca', false),
    ];
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(
      'aialm-oss-po-decompose',
    );
  });

  it('pickup table: generic ✅ only covers po-analyze, not later stages → po-analyze still needs po-prep-decompose', () => {
    const comments = [
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-prep-decompose:872f6f02bbca', true),
      humanApprove, // generic ✅ bez APPROVE:id nie zatwierdza późnych etapów
    ];
    // lastMatch null → fallback daje po-analyze tylko jeśli są po-analyze propozycje; tu ich brak, a po-prep-decompose nie zatwierdzony specyficznie → discover
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBeNull();
  });

  it('ADF glue: po-prep-decompose:872f...packageProposalId + APPROVE:872f... → po-decompose (hex-boundary)', () => {
    // ADF adfToPlainText skleja "...:872f6f02bbcapackageProposalId" — \w+ połknąłby suffix
    const comments = [
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-prep-decompose:872f6f02bbcapackageProposalId: 872f6f02bbca', true),
      commentLike('APPROVE:872f6f02bbca', false),
    ];
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(
      'aialm-oss-po-decompose',
    );
  });

  it('shared account: APPROVE as isAi=true but not AI-marked → counts as human approve → po-decompose', () => {
    const comments = [
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-prep-decompose:872f6f02bbca', true),
      commentLike('APPROVE:872f6f02bbca', true), // shared account: isAi=true ale brak [AI-generated]
    ];
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(
      'aialm-oss-po-decompose',
    );
  });

  it('po-decompose summary marker + APPROVE → qa-analyze (Option A)', () => {
    const comments = [
      commentLike('[AI-generated] Proposal — W-5 — aialm-oss-po-decompose:872f6f02bbca\nproposal:872f6f02bbca\nAwaiting human approval', true),
      commentLike('APPROVE:872f6f02bbca', false),
    ];
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(
      'aialm-oss-qa-analyze',
    );
  });

  it('full chain: qa-analyze → arch → sec → dev-analyst → dev-impl → qa-impl → verify → pr', () => {
    const chain: Array<[string, string]> = [
      ['aialm-oss-qa-analyze', 'aialm-oss-arch-analyze'],
      ['aialm-oss-arch-analyze', 'aialm-oss-sec-analyze'],
      ['aialm-oss-sec-analyze', 'aialm-oss-dev-analyst'],
      ['aialm-oss-dev-analyst', 'aialm-oss-dev-impl'],
      ['aialm-oss-dev-impl', 'aialm-oss-qa-impl'],
      ['aialm-oss-qa-impl', 'aialm-oss-verify'],
      ['aialm-oss-verify', 'aialm-oss-pr'],
    ];
    for (const [from, to] of chain) {
      const id = 'abc1234';
      const comments = [
        commentLike(`[AI-generated] Proposal — C-1 — ${from}:${id}`, true),
        commentLike(`APPROVE:${id}`, false),
      ];
      expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(to);
    }
  });

  it('lastMatch: po-analyze + po-prep-decompose + po-decompose all approved → qa-analyze (furthest wins)', () => {
    const comments = [
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-analyze:1111111', true),
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-prep-decompose:2222222', true),
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-decompose:3333333', true),
      commentLike('APPROVE:1111111', false),
      commentLike('APPROVE:2222222', false),
      commentLike('APPROVE:3333333', false),
    ];
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(
      'aialm-oss-qa-analyze',
    );
  });

  it('no marker for po-decompose → stays at po-decompose (needs explicit decompose approve)', () => {
    const comments = [
      commentLike('[AI-generated] Proposal — C-1 — aialm-oss-po-prep-decompose:872f6f02bbca', true),
      commentLike('APPROVE:872f6f02bbca', false),
      // summary without po-decompose id
      commentLike('[AI-generated] Summary — C-1 — aialm-oss-po-decompose', true),
      commentLike('✅', false), // generic approve but no po-decompose id
    ];
    // last approved is po-prep-decompose → po-decompose, not qa-analyze
    expect(nextAgentAfterApproval({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' }, comments)).toBe(
      'aialm-oss-po-decompose',
    );
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

  it('PICKUP_OK post-approve: AWAITING_HUMAN_APPROVAL w AWAITS HUMAN APPROVAL + po-analyze ✅ → po-prep-decompose', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      { url: '/transitions', fn: (u, init) => (init?.method === 'POST' ? json({}) : json({ transitions: [{ id: '2', name: 'AWAITS AGENT PICKUP', to: { id: '10214', name: 'AWAITS AGENT PICKUP' } }] })) },
      {
        url: '/issue/C-2',
        fn: () =>
          json({
            fields: {
              customfield_10090: { value: 'AWAITING_HUMAN_APPROVAL' },
              customfield_10091: { value: 'AI' },
              customfield_10092: { value: 'none' },
              status: { name: 'AWAITS HUMAN APPROVAL' },
            },
          }),
      },
      {
        url: '/comment',
        fn: () =>
          json({
            comments: [
              { id: '1', author: { accountId: 'ai-bot' }, body: '[AI-generated] Proposal — C-2 — aialm-oss-po-analyze:6657279bf763', reactions: [] },
              { id: '2', author: { accountId: 'ai-bot' }, body: '[AI-generated] Proposal — C-2 — aialm-oss-po-analyze:826f84c42a5f', reactions: [] },
              { id: '3', author: { accountId: 'human-1' }, body: '✅', reactions: [] },
            ],
          }),
      },
    ]);
    const row = await advanceOne(jira, 'C-2', { cids: CIDS });
    expect(row.result).toBe('PICKUP_OK');
    expect(row.status).toBe('AWAITS AGENT PICKUP');
    expect(row.detail).toContain('aialm-oss-po-prep-decompose');
    expect(row.detail).toContain('AWAITS HUMAN APPROVAL →');
  });

  it('NO_APPROVAL post-approve: AWAITING_HUMAN_APPROVAL w AWAITS HUMAN APPROVAL bez ✅ → NO_APPROVAL', async () => {
    const jira = makeJira([
      ...selfAwareHandlers(),
      {
        url: '/issue/C-2',
        fn: () =>
          json({
            fields: {
              customfield_10090: { value: 'AWAITING_HUMAN_APPROVAL' },
              customfield_10091: { value: 'AI' },
              customfield_10092: { value: 'none' },
              status: { name: 'AWAITS HUMAN APPROVAL' },
            },
          }),
      },
      {
        url: '/comment',
        fn: () =>
          json({ comments: [{ id: '1', author: { accountId: 'ai-bot' }, body: '[AI-generated] Proposal — C-2 — aialm-oss-po-analyze:abc', reactions: [] }] }),
      },
    ]);
    const row = await advanceOne(jira, 'C-2', { cids: CIDS });
    expect(row.result).toBe('NO_APPROVAL');
  });
});

