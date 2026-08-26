import { describe, expect, it, vi } from 'vitest';
import { branchForWave, resolveFork, syncForkCommands } from '../../src/aialm/oss/github/fork.ts';
import type { GithubClient } from '../../src/aialm/oss/github/github.ts';

describe('branchForWave', () => {
  it('builds hybrid branch name from repo basename, issue number and wave key', () => {
    const b = branchForWave({ repo: 'steamnoid/wellbeing-tracker-public', issueNumber: 1, workItemIds: ['WELLBEINGT-2'] });
    expect(b).toMatch(/^aialm-oss\/wellbeing-tracker-public-1-[0-9a-f]{7}$/);
  });

  it('is stable for the same wave and distinct across waves', () => {
    const a = branchForWave({ repo: 'steamnoid/wellbeing-tracker-public', issueNumber: 1, workItemIds: ['WELLBEINGT-2'] });
    const a2 = branchForWave({ repo: 'steamnoid/wellbeing-tracker-public', issueNumber: 1, workItemIds: ['WELLBEINGT-2'] });
    const b = branchForWave({ repo: 'steamnoid/wellbeing-tracker-public', issueNumber: 1, workItemIds: ['WELLBEINGT-2', 'WELLBEINGT-3'] });
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });
});

describe('resolveFork', () => {
  function gh(login: string) {
    return { me: vi.fn(async () => ({ login: login as string })), ensureFork: vi.fn(async () => ({ full_name: `${login}/r`, default_branch: 'main' })) } as unknown as GithubClient;
  }

  it('ensures a fork when the authenticated account is the fork owner', async () => {
    const g = gh('paligakrzychu');
    const r = await resolveFork(g, { owner: 'steamnoid', repo: 'wellbeing-tracker-public', forkOwner: 'paligakrzychu' });
    expect(r.fullName).toBe('paligakrzychu/r');
    expect(r.created).toBe(true);
  });

  it('references an existing fork without creating when fork owner differs from the account', async () => {
    const g = gh('someaccount');
    const r = await resolveFork(g, { owner: 'steamnoid', repo: 'wellbeing-tracker-public', forkOwner: 'paligakrzychu' });
    expect(r.fullName).toBe('paligakrzychu/wellbeing-tracker-public');
    expect(r.created).toBe(false);
  });
});

describe('syncForkCommands', () => {
  it('returns deterministic git commands to rebase a feature branch on upstream base', () => {
    const cmds = syncForkCommands({ upstream: 'https://github.com/steamnoid/wellbeing-tracker-public', forkRemote: 'origin', base: 'main', branch: 'aialm-oss/x' });
    expect(cmds).toContain('git fetch upstream');
    expect(cmds).toContain('git reset --hard upstream/main');
    expect(cmds).toContain('git checkout -B aialm-oss/x');
    expect(cmds.some(c => c.startsWith('git rebase upstream/main'))).toBe(true);
    expect(cmds).toContain('git push --force-with-lease origin aialm-oss/x');
  });
});

import { cloneWave, waveWorkdir } from '../../src/aialm/oss/github/fork.ts';

describe('cloneWave', () => {
  it('isolates a wave in its own workdir and syncs its own branch', () => {
    const w = cloneWave({ upstream: 'https://github.com/steamnoid/wellbeing-tracker-public', forkRepo: 'https://x-access-token:t@github.com/paligakrzychu/wellbeing-tracker-public', base: 'main', branch: 'aialm-oss/x', workKey: 'WELLBEINGT-2' });
    expect(w.dir).toBe('.work/WELLBEINGT-2');
    expect(w.commands[0]).toBe('rm -rf .work/WELLBEINGT-2');
    expect(w.commands[1]).toContain('git clone');
    expect(w.commands.some(c => c.includes('cd .work/WELLBEINGT-2 && git fetch upstream'))).toBe(true);
    expect(w.commands.some(c => c.includes('cd .work/WELLBEINGT-2 && git checkout -B aialm-oss/x'))).toBe(true);
    expect(waveWorkdir('WELLBEINGT-2')).toBe('.work/WELLBEINGT-2');
  });
});
