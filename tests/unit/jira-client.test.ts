import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraClient, JiraError, adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const cfg = { site: 'https://x.atlassian.net', email: 'e@x.com', token: 'tok' };

function makeClient(calls: { url: string; init: RequestInit }[]) {
  const fetchImpl = vi.fn(async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(200, {});
  }) as unknown as typeof fetch;
  return new JiraClient({ config: cfg, fetchImpl });
}

describe('JiraClient seam', () => {
  let calls: { url: string; init: RequestInit }[];
  let client: JiraClient;

  beforeEach(() => {
    calls = [];
    client = makeClient(calls);
  });

  it('sends basic auth and JSON body on addComment', async () => {
    await client.addComment('AIALMOSS-4', doc(para('hi')));
    const c0 = calls[0]!;
    expect(c0.url).toBe('https://x.atlassian.net/rest/api/3/issue/AIALMOSS-4/comment');
    expect((c0.init.headers as any).Authorization.startsWith('Basic ')).toBe(true);
    const body = JSON.parse(String(c0.init.body));
    expect(body.body.type).toBe('doc');
  });

  it('paginates searchJql via nextPageToken', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { issues: [{ key: 'A-1' }], nextPageToken: 'T2' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { issues: [{ key: 'A-2' }] }));
    const c2 = new JiraClient({ config: cfg, fetchImpl: f as unknown as typeof fetch });
    const issues = await c2.searchJql('project=X', ['key']);
    expect(issues.map(i => i.key)).toEqual(['A-1', 'A-2']);
    const second = JSON.parse(String((f.mock.calls[1] as any)[1].body));
    expect(second.nextPageToken).toBe('T2');
  });

  it('throws JiraError with detail on failure', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(404, { errorMessages: ['nope'] }));
    const c3 = new JiraClient({ config: cfg, fetchImpl: f as unknown as typeof fetch });
    await expect(c3.getIssue('NOPE-1')).rejects.toBeInstanceOf(JiraError);
  });

  it('projectExists tolerates 404 only', async () => {
    const f404 = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    expect(await makeClientWith(f404).projectExists('MISSING')).toBe(false);
    const f500 = vi.fn().mockResolvedValue(jsonResponse(500, { errorMessages: ['boom'] }));
    await expect(makeClientWith(f500).projectExists('X')).rejects.toBeInstanceOf(JiraError);
  });

  it('adfToPlainText flattens nested content incl. code blocks', () => {
    const d = doc(para({ t: 'APPROVE:', b: true }, '0ab12cd'), codeBlock('GENERATED QA hash: x'));
    const text = adfToPlainText(d);
    expect(text).toContain('APPROVE:');
    expect(text).toContain('GENERATED QA hash: x');
  });

  it('adfToPlainText renders emoji nodes via their attrs.text', () => {
    const emoji = { type: 'emoji', attrs: { shortName: ':white_check_mark:', id: '2705', text: '✅' } };
    const d = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [emoji, { type: 'text', text: ' ok' }] }] };
    expect(adfToPlainText(d)).toBe('✅ ok');
  });

  it('addAiComment refuses an unmarked approval-shaped comment (self-approval guard)', async () => {
    const unmarked = doc(para('APPROVE:8d1e8e8'));
    await expect(client.addAiComment('AIALMOSS-4', unmarked)).rejects.toThrow(/self-approval/);
    const marked = doc(para('[AI-generated] Proposal — AIALMOSS-4 — aialm-oss-po-analyze:8d1e8e8'));
    await client.addAiComment('AIALMOSS-4', marked);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('createKanbanProject uses the team-managed simplified-agility template', async () => {
    await client.createKanbanProject({ key: 'WIDGETS', name: '[AI-ALM] a/widgets', leadAccountId: 'L1' });
    const post = calls.find(c => c.url.endsWith('/rest/api/3/project'))!;
    const body = JSON.parse(String(post.init.body));
    expect(body.projectTemplateKey).toBe('com.pyxis.greenhopper.jira:gh-simplified-agility-kanban');
  });

  it('createProjectStatuses POSTs scope=PROJECT and is idempotent across existing names', async () => {
    const statuses = [{ name: 'Candidates Pool', statusCategory: 'TODO' }];
    const postBodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: any, init: any = {}) => {
      const u = String(url);
      if (u.endsWith('/rest/api/3/project/WIDGETS')) return jsonResponse(200, { id: '42' });
      if (u.endsWith('/rest/api/3/statuses')) {
        postBodies.push(JSON.parse(String(init.body)));
        // name already in use → 400 with that message
        return jsonResponse(400, { errorMessages: ['Status name "Candidates Pool" already in use. Try a different name.'] });
      }
      return jsonResponse(200, {});
    });
    const c = new JiraClient({ config: cfg, fetchImpl: f as unknown as typeof fetch });
    const r = await c.createProjectStatuses('WIDGETS', statuses);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.existing).toContain('Candidates Pool');
    // Batch POST first, then per-status POST (also "already in use" → skipped).
    expect(postBodies.length).toBeGreaterThan(0);
    expect(postBodies[0]).toMatchObject({ scope: { type: 'PROJECT', project: '42' } });
  });

  it('createProjectStatuses POSTs statuses on a fresh project (batch succeeds)', async () => {
    const statuses = [{ name: 'Candidates Pool', statusCategory: 'TODO' }];
    const postBodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: any, init: any = {}) => {
      const u = String(url);
      if (u.endsWith('/rest/api/3/project/WIDGETS')) return jsonResponse(200, { id: '42' });
      if (u.endsWith('/rest/api/3/statuses')) {
        postBodies.push(JSON.parse(String(init.body)));
        return jsonResponse(200, {});
      }
      return jsonResponse(200, {});
    });
    const c = new JiraClient({ config: cfg, fetchImpl: f as unknown as typeof fetch });
    const r = await c.createProjectStatuses('WIDGETS', statuses);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.existing).toEqual([]);
    // batch POST only (no per-status fallback)
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toMatchObject({ scope: { type: 'PROJECT', project: '42' } });
  });
});

function makeClientWith(f: ReturnType<typeof vi.fn>) {
  return new JiraClient({ config: cfg, fetchImpl: f as unknown as typeof fetch });
}
