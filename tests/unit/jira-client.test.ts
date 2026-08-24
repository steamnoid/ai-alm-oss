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
});

function makeClientWith(f: ReturnType<typeof vi.fn>) {
  return new JiraClient({ config: cfg, fetchImpl: f as unknown as typeof fetch });
}
