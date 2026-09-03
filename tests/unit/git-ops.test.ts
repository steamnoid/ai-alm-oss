import { describe, it, expect, vi } from 'vitest';
import {
  waveKeyFor,
  branchForWave,
  workDirFor,
  httpsPushUrl,
  redactedPushUrl,
  cloneArgs,
  checkoutArgs,
  ensureFork,
} from '../../src/aialm/oss/shared/git-ops.js';
import { GithubClient } from '../../src/aialm/oss/adapter/github.js';

describe('git-ops — pure helpers', () => {
  it('waveKeyFor lower-cases and validates', () => {
    expect(waveKeyFor('WELLBEINGT-5')).toBe('wellbeingt-5');
    expect(waveKeyFor(' AAO-123 ')).toBe('aao-123');
    expect(() => waveKeyFor('bad')).toThrow(/invalid issue key/);
    expect(() => waveKeyFor('WELLBEINGT-')).toThrow();
  });

  it('branchForWave', () => {
    expect(branchForWave('WELLBEINGT-5')).toBe('aialm/wellbeingt-5');
    expect(branchForWave('PROJ-42')).toBe('aialm/proj-42');
  });

  it('workDirFor', () => {
    expect(workDirFor('WELLBEINGT-5')).toBe('.work/wellbeingt-5');
    expect(workDirFor('WELLBEINGT-5', '.work')).toBe('.work/wellbeingt-5');
    expect(workDirFor('WELLBEINGT-5', '/tmp/work/')).toBe('/tmp/work/wellbeingt-5');
  });

  it('httpsPushUrl builds URL with token', () => {
    const url = httpsPushUrl('acme', 'repo', 'ghp_xxx');
    expect(url).toBe('https://x-access-token:ghp_xxx@github.com/acme/repo.git');
  });

  it('httpsPushUrl encodes token', () => {
    const url = httpsPushUrl('o', 'r', 'a/b@c');
    expect(url).toContain(encodeURIComponent('a/b@c'));
  });

  it('httpsPushUrl validates', () => {
    expect(() => httpsPushUrl('', 'r', 't')).toThrow(/owner required/);
    expect(() => httpsPushUrl('o', '', 't')).toThrow(/repo required/);
    expect(() => httpsPushUrl('o', 'r', '')).toThrow(/token required/);
  });

  it('redactedPushUrl', () => {
    expect(redactedPushUrl('https://x-access-token:secret@github.com/o/r.git')).toBe(
      'https://***@github.com/o/r.git',
    );
    expect(redactedPushUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
  });

  it('cloneArgs / checkoutArgs', () => {
    expect(cloneArgs('https://x@github.com/o/r.git', '.work/wellbeingt-5')).toEqual([
      'clone',
      'https://x@github.com/o/r.git',
      '.work/wellbeingt-5',
    ]);
    expect(checkoutArgs('.work/wellbeingt-5', 'aialm/wellbeingt-5')).toEqual([
      '-C',
      '.work/wellbeingt-5',
      'checkout',
      '-B',
      'aialm/wellbeingt-5',
    ]);
  });
});

describe('git-ops — ensureFork', () => {
  function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }

  it('creates fork via POST /repos/:owner/:repo/forks', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: unknown) => {
      const u = String(url);
      if (u.endsWith('/user')) return json({ login: 'bot' });
      if (u.endsWith('/forks')) {
        const body = JSON.parse(String((init as RequestInit).body ?? '{}'));
        expect(body.default_branch_only).toBe(true);
        return json({ html_url: 'https://github.com/bot/repo', owner: { login: 'bot' } }, 202);
      }
      throw new Error(`unexpected ${u}`);
    });
    const client = new GithubClient({ token: 'tok', fetchImpl: fetchImpl as typeof fetch });
    const out = await ensureFork('upstream', 'repo', { client });
    expect(out.forkOwner).toBe('bot');
    expect(out.htmlUrl).toContain('github.com/bot/repo');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('422 already forked → idempotent success', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/user')) return json({ login: 'bot2' });
      if (u.endsWith('/forks')) {
        return new Response(JSON.stringify({ message: 'fork already exists' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected ${u}`);
    });
    const client = new GithubClient({ token: 'tok', fetchImpl: fetchImpl as typeof fetch });
    const out = await ensureFork('upstream', 'repo', { client });
    expect(out.forkOwner).toBe('bot2');
    expect(out.htmlUrl).toBe('https://github.com/bot2/repo');
  });

  it('falls back to owner when /user fails', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/user')) return new Response('unauthorized', { status: 401 });
      if (u.endsWith('/forks')) return json({ html_url: 'https://github.com/upstream/repo' }, 202);
      throw new Error(`unexpected ${u}`);
    });
    const client = new GithubClient({ token: 'tok', fetchImpl: fetchImpl as typeof fetch });
    const out = await ensureFork('upstream', 'repo', { client });
    expect(out.forkOwner).toBe('upstream');
  });
});
