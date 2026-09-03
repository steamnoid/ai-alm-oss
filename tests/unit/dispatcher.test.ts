import { describe, it, expect } from 'vitest';
import { JiraClient, testConfig } from '../../src/aialm/oss/adapter/jira.js';
import {
  pickupJql,
  scanPickupTickets,
  agentToSkill,
  isDispatchableAgent,
  buildDockerRunSpec,
  containerNameFor,
  labelFor,
  parseInspectJson,
  DISPATCH_LABEL,
  DISPATCH_IMAGE_DEFAULT,
} from '../../src/aialm/oss/dispatcher/index.js';
import type { SelfAwareCids } from '../../src/aialm/oss/adapter/fields-config.js';

const CIDS: SelfAwareCids = { stage: 'customfield_10090', role: 'customfield_10091', agent: 'customfield_10092' };

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

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

describe('dispatcher — pure helpers', () => {
  it('pickupJql targets AWAITS AGENT PICKUP for project', () => {
    expect(pickupJql('WELLBEINGT')).toContain('project = WELLBEINGT');
    expect(pickupJql('WELLBEINGT')).toContain('AWAITS AGENT PICKUP');
  });

  it('agentToSkill/isDispatchableAgent', () => {
    expect(agentToSkill('aialm-oss-po-analyze')).toBe('aialm-oss-po-analyze');
    expect(isDispatchableAgent('aialm-oss-po-analyze')).toBe(true);
    expect(isDispatchableAgent('aialm-oss-qa-analyze')).toBe(true);
    expect(isDispatchableAgent('none')).toBe(false);
    expect(isDispatchableAgent('')).toBe(false);
    expect(isDispatchableAgent('random')).toBe(false);
  });

  it('containerNameFor/labelFor', () => {
    const n = containerNameFor('WELLBEINGT', 'WELLBEINGT-5', 'abc123');
    expect(n).toContain('aialm-');
    expect(n).toContain('wellbeingt-wellbeingt-5');
    expect(n).toContain('abc123');
    expect(labelFor('WELLBEINGT-5')).toBe('WELLBEINGT-5');
  });

  it('buildDockerRunSpec: trivial detached, skill owns Jira', () => {
    const spec = buildDockerRunSpec(
      { key: 'WELLBEINGT-5', agent: 'aialm-oss-po-analyze' },
      { projectKey: 'WELLBEINGT', image: 'ai-alm-oss:local', hostCwd: '/tmp/app', hostOpencodeConfigDir: '/tmp/cfg', nameSuffix: 'ent123' },
    );
    expect(spec.containerName).toContain('aialm-');
    expect(spec.label).toBe('WELLBEINGT-5');
    // detached + label + health
    expect(spec.args).toContain('-d');
    expect(spec.args).toContain(`${DISPATCH_LABEL}=WELLBEINGT-5`);
    expect(spec.args).toContain('--health-cmd');
    // mounts
    expect(spec.args).toContain('/tmp/app:/app');
    expect(spec.args).toContain('/tmp/cfg:/home/node/.config/opencode:ro');
    expect(spec.args).toContain('--env-file');
    // image + skill entrypoint at tail — skill does all Jira
    expect(spec.args[spec.args.length - 4]).toBe('opencode');
    expect(spec.args).toContain('aialm-oss-po-analyze');
    expect(spec.args).toContain('WELLBEINGT-5');
    expect(spec.args).toContain(DISPATCH_IMAGE_DEFAULT);
  });

  it('buildDockerRunSpec without opencode dir omits that mount', () => {
    const spec = buildDockerRunSpec(
      { key: 'WELLBEINGT-5', agent: 'aialm-oss-qa-analyze' },
      { projectKey: 'WELLBEINGT', hostCwd: '/app', nameSuffix: 'x' },
    );
    expect(spec.args.join(' ')).not.toContain('.config/opencode');
    expect(spec.args).toContain('--env-file');
  });

  it('parseInspectJson handles running/healthy/exit', () => {
    const raw = JSON.stringify([
      {
        Id: 'abc123def456789',
        Name: '/aialm-wellbeingt-5-xyz',
        Config: { Labels: { 'aialm.dispatch': 'WELLBEINGT-5', 'aialm.project': 'WELLBEINGT' } },
        State: { Status: 'running', ExitCode: 0, Health: { Status: 'starting' } },
      },
    ]);
    const s = parseInspectJson(raw);
    expect(s?.id).toBe('abc123def456');
    expect(s?.name).toBe('aialm-wellbeingt-5-xyz');
    expect(s?.key).toBe('WELLBEINGT-5');
    expect(s?.state).toBe('running');
    expect(s?.health).toBe('starting');
  });

  it('parseInspectJson handles exited without health', () => {
    const raw = JSON.stringify([
      { Id: 'deadbeef', Name: '/aialm-x', Config: { Labels: { 'aialm.dispatch': 'WELLBEINGT-9' } }, State: { Status: 'exited', ExitCode: 1 } },
    ]);
    const s = parseInspectJson(raw);
    expect(s?.state).toBe('exited');
    expect(s?.exitCode).toBe(1);
    expect(s?.health).toBeUndefined();
  });
});

describe('dispatcher — scanPickupTickets', () => {
  it('returns only tickets with dispatchable agent in AWAITS AGENT PICKUP', async () => {
    const jira = makeJira([
      {
        url: '/search/jql',
        fn: async (_u, init) => {
          const body = JSON.parse(String(init?.body ?? '{}')) as { jql?: string };
          expect(body.jql).toContain('AWAITS AGENT PICKUP');
          expect(body.jql).toContain('WELLBEINGT');
          return json({
            issues: [
              { key: 'WELLBEINGT-5', fields: { customfield_10090: { value: 'AWAITING_AGENT_PICKUP' }, customfield_10092: { value: 'aialm-oss-po-analyze' }, status: { name: 'AWAITS AGENT PICKUP' } } },
              { key: 'WELLBEINGT-6', fields: { customfield_10090: { value: 'AWAITING_AGENT_PICKUP' }, customfield_10092: { value: 'none' }, status: { name: 'AWAITS AGENT PICKUP' } } },
              { key: 'WELLBEINGT-7', fields: { customfield_10090: { value: 'AWAITING_AGENT_PICKUP' }, customfield_10092: { value: 'aialm-oss-qa-analyze' }, status: { name: 'AWAITS AGENT PICKUP' } } },
            ],
          });
        },
      },
    ]);
    const out = await scanPickupTickets(jira, 'WELLBEINGT', CIDS);
    expect(out.map(o => o.key)).toEqual(['WELLBEINGT-5', 'WELLBEINGT-7']);
    expect(out.find(o => o.key === 'WELLBEINGT-5')?.agent).toBe('aialm-oss-po-analyze');
    expect(out.find(o => o.key === 'WELLBEINGT-7')?.agent).toBe('aialm-oss-qa-analyze');
  });

  it('empty when no pickup', async () => {
    const jira = makeJira([{ url: '/search/jql', fn: () => json({ issues: [] }) }]);
    const out = await scanPickupTickets(jira, 'WELLBEINGT', CIDS);
    expect(out).toEqual([]);
  });

  it('respects limit', async () => {
    const jira = makeJira([
      {
        url: '/search/jql',
        fn: async (_u, init) => {
          const body = JSON.parse(String(init?.body ?? '{}')) as { maxResults?: number };
          expect(body.maxResults).toBe(3);
          return json({ issues: [] });
        },
      },
    ]);
    await scanPickupTickets(jira, 'WELLBEINGT', CIDS, { limit: 3 });
  });
});
