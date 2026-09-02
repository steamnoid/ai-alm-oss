import { describe, it, expect } from 'vitest';
import { readStateFromFields, fieldsFromState, SELF_AWARE_FIELDS, isDefaultState } from '../../src/aialm/oss/adapter/fields.js';
import { isFunctionalSubtask, isExclusiveSubticketMode, buildWorkItemContext, type WorkItemSnapshot } from '../../src/aialm/oss/adapter/context.js';
import { adfToPlainText, markdownToAdf, asAdf } from '../../src/aialm/oss/adapter/adf.js';
import { JiraClient, testConfig } from '../../src/aialm/oss/adapter/jira.js';

const f = SELF_AWARE_FIELDS;

describe('self-aware fields (per-klient)', () => {
  it('reads a consistent triple from a field map', () => {
    const s = readStateFromFields({
      [f.stage]: { value: 'AWAITING_AGENT_PICKUP' },
      [f.role]: { value: 'PO' },
      [f.agent]: { value: 'aialm-oss-po-analyze' },
    });
    expect(s).toEqual({ stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent: 'aialm-oss-po-analyze' });
  });

  it('reads raw string values too (not only {value})', () => {
    const s = readStateFromFields({ [f.stage]: 'IN_PROGRESS_BY_AGENT', [f.role]: 'DEV', [f.agent]: 'aialm-oss-dev-impl' });
    expect(s.agent).toBe('aialm-oss-dev-impl');
  });

  it('returns DEFAULT_STATE when fields are absent', () => {
    expect(readStateFromFields({})).toEqual({ stage: 'IDLE', role: null, agent: 'none' });
  });

  it('falls back to default on an inconsistent triple (agent on IDLE)', () => {
    const s = readStateFromFields({ [f.stage]: 'IDLE', [f.role]: 'PO', [f.agent]: 'aialm-oss-dev-impl' });
    expect(s).toEqual({ stage: 'IDLE', role: null, agent: 'none' });
  });

  it('fieldsFromState omits null role', () => {
    expect(fieldsFromState({ stage: 'DONE', role: null, agent: 'none' })).toEqual({ stage: 'DONE', agent: 'none' });
  });

  it('isDefaultState detects the clean ticket', () => {
    expect(isDefaultState({ stage: 'IDLE', role: null, agent: 'none' })).toBe(true);
    expect(isDefaultState({ stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent: 'aialm-oss-po-analyze' })).toBe(false);
  });
});

describe('child classification (exclusive subticket mode)', () => {
  const kid = (summary: string, parent?: string): WorkItemSnapshot => ({
    id: 'x',
    key: 'C-1',
    summary,
    descriptionText: '',
    state: { stage: 'IDLE', role: null, agent: 'none' },
    labels: [],
    issueType: 'Subtask',
    ...(parent ? { parentKey: parent } : {}),
  });

  it('isFunctionalSubtask: has parent and not legacy [QA]', () => {
    expect(isFunctionalSubtask(kid('do the thing', 'C-0'))).toBe(true);
    expect(isFunctionalSubtask(kid('[QA] do the thing', 'C-0'))).toBe(false);
    expect(isFunctionalSubtask(kid('no parent'))).toBe(false);
  });

  it('exclusive mode requires ≥1 functional child', () => {
    expect(isExclusiveSubticketMode([kid('[QA] old', 'C-0')])).toBe(false);
    expect(isExclusiveSubticketMode([kid('feature', 'C-0')])).toBe(true);
  });

  it('buildWorkItemContext decodes a triple into the snapshot state', () => {
    const ctx = buildWorkItemContext({
      workItem: {
        id: '100',
        key: 'C-9',
        summary: 'thing',
        fields: { [f.stage]: { value: 'IN_PROGRESS_BY_AGENT' }, [f.role]: { value: 'QA' }, [f.agent]: { value: 'aialm-oss-qa-impl' } },
      },
    });
    expect(ctx.workItem.state.agent).toBe('aialm-oss-qa-impl');
    expect(ctx.workItem.state.stage).toBe('IN_PROGRESS_BY_AGENT');
  });
});

describe('adf helpers', () => {
  it('markdownToAdf → adfToPlainText round-trips text', () => {
    const adf = markdownToAdf('line one\nline two');
    const txt = adfToPlainText(adf);
    expect(txt.replace(/\n/g, ' ')).toContain('line one');
    expect(txt.replace(/\n/g, ' ')).toContain('line two');
  });

  it('asAdf validates a doc node', () => {
    expect(() => asAdf({ type: 'doc', version: 1, content: [] })).not.toThrow();
    expect(() => asAdf('nope')).toThrow(/Not an ADF/);
  });
});

describe('JiraClient (fetch seam)', () => {
  it('Calls the API base with basic auth and parses JSON', async () => {
    const calls: unknown[] = [];
    const fetchImpl = async (url: unknown, init?: unknown): Promise<Response> => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ key: 'C-1', summary: 'hi' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const client = new JiraClient({ config: testConfig(), fetchImpl: fetchImpl as typeof fetch });
    const issue = await client.getIssue('C-1', ['summary']);
    expect(issue).toEqual({ key: 'C-1', summary: 'hi' });
    const call = calls[0] as { url: string; init: { headers: Record<string, string> } };
    expect(call.url).toContain('/rest/api/3/issue/C-1?fields=summary');
    expect(call.init.headers.Authorization).toContain('Basic ');
  });

  it('throws JiraError on non-ok with errorMessages', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ errorMessages: ['boom'] }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const client = new JiraClient({ config: testConfig(), fetchImpl: fetchImpl as typeof fetch });
    await expect(client.getIssue('C-1')).rejects.toThrow('boom');
  });

  it('updateState sends {value} select payloads and syncs status labels', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = async (u: unknown, init?: unknown): Promise<Response> => {
      const url = String(u);
      const method = (init as { method?: string } | undefined)?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(JSON.stringify({ fields: { labels: ['candidate'] } }), { status: 200 });
      }
      bodies.push(JSON.parse(String((init as { body?: string } | undefined)?.body ?? '{}')));
      return new Response(null, { status: 204 });
    };
    const client = new JiraClient({ config: testConfig(), fetchImpl: fetchImpl as typeof fetch });
    await client.updateState(
      'C-1',
      { stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent: 'aialm-oss-po-analyze' },
      { stage: 'cf1', role: 'cf2', agent: 'cf3' },
    );
    // body[0] = custom-field updates; body[1] = label sync (drops candidate, adds aialm labels).
    expect(bodies[0]).toEqual({
      fields: {
        cf1: { value: 'AWAITING_AGENT_PICKUP' },
        cf2: { value: 'PO' },
        cf3: { value: 'aialm-oss-po-analyze' },
      },
    });
    expect(bodies[1]).toEqual({
      fields: {
        labels: ['aialm:stage:awaiting-agent-pickup', 'aialm:role:po', 'candidate'],
      },
    });
  });

  it('updateState drops stale owned labels but preserves foreign labels', async () => {
    let putCalled = 0;
    const fetchImpl = async (u: unknown, init?: unknown): Promise<Response> => {
      const method = (init as { method?: string } | undefined)?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ fields: { labels: ['candidate', 'aialm:stage:done', 'aialm:role:po'] } }),
          { status: 200 },
        );
      }
      putCalled++;
      return new Response(null, { status: 204 });
    };
    const client = new JiraClient({ config: testConfig(), fetchImpl: fetchImpl as typeof fetch });
    await client.updateState('C-1', { stage: 'AWAITING_HUMAN_APPROVAL', role: 'PO', agent: 'none' }, {});
    // State labels: stage=awaiting-human-approval, role=po. Owned `aialm:stage:done`
    // is stale → dropped; `aialm:role:po` kept; foreign `candidate` preserved.
    expect(putCalled).toBe(1);
  });

  it('updateState no-ops entirely when no CIDs and no owned labels on issue', async () => {
    let putCalled = 0;
    const fetchImpl = async (u: unknown, init?: unknown): Promise<Response> => {
      const method = (init as { method?: string } | undefined)?.method ?? 'GET';
      if (method === 'GET') return new Response(JSON.stringify({ fields: { labels: [] } }), { status: 200 });
      putCalled++;
      return new Response(null, { status: 204 });
    };
    const client = new JiraClient({ config: testConfig(), fetchImpl: fetchImpl as typeof fetch });
    await client.updateState('C-1', { stage: 'IDLE', role: null, agent: 'none' }, {});
    // Empty CIDs → no field PUT. Labels on issue = [] → desired = [aialm:stage:idle];
    // so exactly one label-sync PUT fires (no role label).
    expect(putCalled).toBe(1);
  });
});