import { describe, expect, it, vi } from 'vitest';
import { GithubClient } from '../../src/aialm/oss/github/github.ts';

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GithubClient fork helpers', () => {
  it('httpsPushUrl embeds the token without exposing it as a plain https cred', () => {
    const c = new GithubClient({ fetchImpl: vi.fn() as unknown as typeof fetch, token: '' });
    const u = c.httpsPushUrl('paligakrzychu', 'wellbeing-tracker-public', 'tok');
    expect(u).toBe('https://x-access-token:tok@github.com/paligakrzychu/wellbeing-tracker-public');
  });

  it('ensureFork reuses an existing fork (GET first, no 422 POST)', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: any) => {
      calls.push(String(url));
      if (String(url).includes('/user')) return json(200, { login: 'paligakrzychu' });
      if (String(url).includes('/repos/paligakrzychu/wellbeing-tracker-public')) {
        return json(200, { full_name: 'paligakrzychu/wellbeing-tracker-public', default_branch: 'main', fork: true, html_url: 'x' });
      }
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;
    const c = new GithubClient({ fetchImpl: f, token: 't' });
    const r = await c.ensureFork('steamnoid', 'wellbeing-tracker-public');
    expect(r.full_name).toBe('paligakrzychu/wellbeing-tracker-public');
    expect(calls.some(u => u.includes('/forks'))).toBe(false);
  });
});
