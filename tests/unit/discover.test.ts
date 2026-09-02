import { describe, it, expect } from 'vitest';
import { JiraClient, testConfig } from '../../src/aialm/oss/adapter/jira.js';
import { GithubClient } from '../../src/aialm/oss/adapter/github.js';
import { persistCandidates } from '../../src/aialm/oss/discover/persist.js';
import { buildCandidateMarkdown } from '../../src/aialm/oss/discover/persist.js';
import { externalRef, externalMarker, extractExternalRef, summaryForCandidate } from '../../src/aialm/oss/discover/candidate.js';
import { qualifyIssue, runDiscover } from '../../src/aialm/oss/discover/index.js';
import type { IssueRef } from '../../src/aialm/oss/adapter/github.js';

function issue(over: Partial<IssueRef> = {}): IssueRef {
  return {
    number: 1,
    title: 'fix: something',
    body: 'Description with .ts reference',
    state: 'open',
    html_url: 'https://github.com/a/b/issues/1',
    labels: [],
    ...over,
  };
}

describe('candidate markers', () => {
  it('externalRef is owner/repo#number', () => {
    expect(externalRef('a/b', 7)).toBe('a/b#7');
  });

  it('externalMarker embeds the ref', () => {
    expect(externalMarker('a/b#7')).toBe('aialm-external: a/b#7');
  });

  it('extractExternalRef round-trips from JSON-stringified ADF description', () => {
    const md = ['body', externalMarker('a/b#7')].join('\n');
    expect(extractExternalRef(JSON.stringify({ content: md }))).toBe('a/b#7');
  });

  it('summary uses canonical form', () => {
    expect(summaryForCandidate('a/b', 7, 'my title')).toBe('[candidate] a/b#7 — my title');
  });
});

describe('qualification', () => {
  it('well-specified issue → READY', () => {
    const q = qualifyIssue(issue({ title: 'fix: add validator', body: 'Add validation to src/x.ts with tests' }));
    expect(q.recommendation).toBe('READY');
    expect(q.ambiguity).toBe('low');
    expect(q.dependencyRisk).toBe('low');
  });

  it('empty body → NEEDS-CLARIFICATION', () => {
    const q = qualifyIssue(issue({ body: null }));
    expect(q.recommendation).toBe('NEEDS-CLARIFICATION');
    expect(q.ambiguity).toBe('high');
  });

  it('credentials mention → BLOCKED', () => {
    const q = qualifyIssue(issue({ body: 'Needs API key / private infra to run' }));
    expect(q.recommendation).toBe('BLOCKED');
    expect(q.dependencyRisk).toBe('high');
  });
});

describe('persistCandidates (fetch seam)', () => {
  function mockJira(): { client: JiraClient; calls: Record<string, number> } {
    const calls: Record<string, number> = {};
    const fetchImpl = async (url: unknown, init?: unknown): Promise<Response> => {
      const u = String(url);
      const method = ((init as { method?: string } | undefined)?.method ?? 'GET') as string;
      const key = `${method} ${u.split('/rest/api/3/')[1] ?? u}`;
      calls[method] = (calls[method] ?? 0) + 1;

      if (u.endsWith('/field')) {
        return json([
          { id: 'customfield_10000', name: 'AIALM STAGE', custom: true },
          { id: 'customfield_10001', name: 'AIALM ROLE', custom: true },
          { id: 'customfield_10002', name: 'AIALM AGENT', custom: true },
        ]);
      }
      if (u.endsWith('/tabs')) return json([{ id: '10000', name: 'Field Tab' }]);
      if (u.includes('/screens')) return json({ values: [{ id: '2', name: 'C: Kanban Default Issue Screen' }], isLast: true });
      if (u.includes('/context/')) return method === 'GET' ? json({ values: [] }) : json({ options: [{ id: '10020', value: 'IDLE' }] });
      if (u.includes('/context')) return json({ values: [{ id: '10050', isGlobalContext: true }] });

      if (u.endsWith('/search/jql')) return json({ issues: [] });
      if (u.includes('/issue') && method === 'POST' && u.endsWith('/comment') === false) {
        return json({ id: '100', key: 'C-1' });
      }
      if (u.includes('/issue') && method === 'PUT') return new Response(null, { status: 204 });
      if (u.endsWith('/project/C')) {
        return json({ key: 'C', issueTypes: [{ id: '1', name: 'Task' }] });
      }
      return new Response(null, { status: 204 });
    };
    return { client: new JiraClient({ config: testConfig(), fetchImpl: fetchImpl as typeof fetch }), calls };
  }

  it('persists candidate with AWAITING_HUMAN_APPROVAL/PO/none and label', async () => {
    const { client } = mockJira();
    const res = await persistCandidates(client, {
      projectKey: 'C',
      repo: 'a/b',
      candidates: [
        { number: 1, url: 'https://github.com/a/b/issues/1', title: 'fix: x', body: 'body .ts', candidate: qualifyIssue(issue()) },
      ],
    });
    expect(res.created).toEqual([{ ref: 'a/b#1', key: 'C-1' }]);
    expect(res.skipped).toEqual([]);
  });

  it('skips an already-known ref (idempotent)', async () => {
    const existing = {
      issues: [
        {
          key: 'C-1',
          fields: { description: JSON.stringify(['body', externalMarker('a/b#1')].join('\n')) },
        },
      ],
    };
    const client2 = new JiraClient({
      config: testConfig(),
      fetchImpl: (async (url: unknown, init?: unknown): Promise<Response> => {
        const u = String(url);
        const method = ((init as { method?: string } | undefined)?.method ?? 'GET') as string;
        if (u.endsWith('/search/jql')) return json(existing);
        if (u.endsWith('/field')) {
          return json([
            { id: 'customfield_10000', name: 'AIALM STAGE', custom: true },
            { id: 'customfield_10001', name: 'AIALM ROLE', custom: true },
            { id: 'customfield_10002', name: 'AIALM AGENT', custom: true },
          ]);
        }
        if (u.endsWith('/tabs')) return json([{ id: '10000', name: 'Field Tab' }]);
        if (u.includes('/screens')) return json({ values: [{ id: '2', name: 'C: Kanban Default Issue Screen' }], isLast: true });
        if (u.includes('/context') && !u.endsWith('/option')) return json({ values: [{ id: '10050', isGlobalContext: true }] });
        if (u.includes('/context/')) return method === 'GET' ? json({ values: [] }) : json({ options: [{ id: '1', value: 'IDLE' }] });
        if (u.endsWith('/project/C')) return json({ key: 'C', issueTypes: [{ id: '1', name: 'Task' }] });
        if (method === 'POST' && u.includes('/issue')) return json({ id: '1', key: 'C-9' });
        if (method === 'PUT' && u.includes('/issue')) return new Response(null, { status: 204 });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    const res = await persistCandidates(client2, {
      projectKey: 'C',
      repo: 'a/b',
      candidates: [
        { number: 1, url: 'https://github.com/a/b/issues/1', title: 'fix: x', body: 'body', candidate: qualifyIssue(issue()) },
      ],
    });
    expect(res.created).toEqual([]);
    expect(res.skipped).toEqual([{ ref: 'a/b#1', reason: 'already exists' }]);
  });
});

describe('buildCandidateMarkdown', () => {
  it('includes qualification and marker', () => {
    const md = buildCandidateMarkdown({
      repo: 'a/b',
      number: 9,
      url: 'https://github.com/a/b/issues/9',
      title: 't',
      body: 'b',
      candidate: qualifyIssue(issue({ number: 9, title: 't', body: 'b' })),
    });
    expect(md).toContain('aialm-external: a/b#9');
    expect(md).toContain('## Candidate Qualification');
    expect(md).toContain('recommendation: READY');
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('runDiscover (fetch seams)', () => {
  it('lists open issues, persists candidates and reports summary per recommendation', async () => {
    const ghIssues: IssueRef[] = [
      issue({ number: 1, title: 'fix: good one', body: 'Has .ts and tests text' }),
      issue({ number: 2, title: 'blank' , body: null }),
      issue({ number: 3, title: 'needs keys', body: 'Needs API credentials / private infra' }),
    ];

    const gh = new GithubClient({
      fetchImpl: (async (url: unknown): Promise<Response> => {
        if (String(url).includes('/issues?')) return json(ghIssues);
        return json({});
      }) as typeof fetch,
    });

    const jira = new JiraClient({
      config: testConfig(),
      fetchImpl: (async (url: unknown, init?: unknown): Promise<Response> => {
        const u = String(url);
        const method = ((init as { method?: string } | undefined)?.method ?? 'GET') as string;
if (u.endsWith('/field')) {
        return json([
          { id: 'customfield_10000', name: 'AIALM STAGE', custom: true },
          { id: 'customfield_10001', name: 'AIALM ROLE', custom: true },
          { id: 'customfield_10002', name: 'AIALM AGENT', custom: true },
        ]);
      }
        if (u.endsWith('/tabs')) return json([{ id: '10000', name: 'Field Tab' }]);
        if (u.includes('/screens')) return json({ values: [{ id: '2', name: 'C: Kanban Default Issue Screen' }], isLast: true });
        if (u.includes('/context') && !u.endsWith('/option')) return json({ values: [{ id: '10050', isGlobalContext: true }] });
        if (u.includes('/context/')) return method === 'GET' ? json({ values: [] }) : json({ options: [{ id: '1', value: 'IDLE' }] });
        if (u.endsWith('/search/jql')) return json({ issues: [] });
        if (u.endsWith('/project/C')) return json({ key: 'C', issueTypes: [{ id: '1', name: 'Task' }] });
        if (method === 'POST' && u.includes('/issue') && !u.endsWith('/comment')) {
          const body = JSON.parse(String((init as { body?: string })?.body ?? '{}'));
          const labels = (body.fields?.labels ?? []) as string[];
          const rec = labels.find((l: string) => l !== 'candidate');
          return json({ id: '1', key: `C-${ghIssues.length}`, rec: `C-${rec}` });
        }
        if (method === 'PUT' && u.includes('/issue')) return new Response(null, { status: 204 });
        return json({});
      }) as typeof fetch,
    });

    const res = await runDiscover(jira, gh, { owner: 'a', repo: 'b', projectKey: 'C' });
    expect(res.persist.created).toHaveLength(3);
    expect(res.summary.READY.created).toBe(1);
    expect(res.summary['NEEDS-CLARIFICATION'].created).toBe(1);
    expect(res.summary.BLOCKED.created).toBe(1);
  });
});