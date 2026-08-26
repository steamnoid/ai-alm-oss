import type { GithubClient } from './github.ts';
import { prWaveKey } from '../pr/pr.ts';

/** Hybrid branch name: `aialm-oss/<repo>-<issue#>-<waveKey7>`. */
export function branchForWave(input: { repo: string; issueNumber: number; workItemIds: string[] }): string {
  const repo = input.repo.replace(/^[^/]+\//, ''); // basename of owner/repo
  const wave = prWaveKey(input.workItemIds).slice(0, 7);
  return `aialm-oss/${repo}-${input.issueNumber}-${wave}`;
}

/**
 * Resolve the fork repo for a contribution. When the authenticated account IS the
 * fork owner, ensure the fork exists (create once); otherwise assume it exists and
 * just reference `forkOwner/<repo>`.
 */
export async function resolveFork(
  gh: GithubClient,
  input: { owner: string; repo: string; forkOwner: string },
): Promise<{ fullName: string; created: boolean }> {
  const { owner, repo, forkOwner } = input;
  let login = '';
  try {
    login = ((await gh.me()).login as string) ?? '';
  } catch {
    /* unauthenticated read */
  }
  if (login === forkOwner) {
    const info = await gh.ensureFork(owner, repo);
    return { fullName: info.full_name, created: true };
  }
  return { fullName: `${forkOwner}/${repo}`, created: false };
}

/** Deterministic git commands to sync the fork feature branch onto upstream base. */
export function syncForkCommands(input: { upstream: string; forkRemote: string; base: string; branch: string }): string[] {
  const { upstream, forkRemote, base, branch } = input;
  return [
    `git remote add upstream ${upstream} 2>/dev/null || true`,
    `git fetch upstream`,
    `git checkout ${base} 2>/dev/null || git checkout -b ${base}`,
    `git reset --hard upstream/${base}`,
    `git checkout -B ${branch}`,
    `git rebase upstream/${base} 2>/dev/null || true`,
    // force-with-lease makes re-runs reproducible: fresh clone resets branch to upstream/base,
    // so second push without force would be rejected (non-fast-forward)
    `git push --force-with-lease ${forkRemote} ${branch}`,
  ];
}

/** Per-wave isolated working directory under `.work/<workKey>`. */
export function waveWorkdir(workKey: string): string {
  return `.work/${workKey}`;
}

/**
 * Isolate one wave in its own fork clone so parallel waves never share a working
 * copy. Returns the workdir + shell commands (clone fork, add upstream, sync the
 * feature branch). `forkRepo` is a push-able URL (token-embedded HTTPS or SSH).
 */
export function cloneWave(input: { upstream: string; forkRepo: string; base: string; branch: string; workKey: string }): { dir: string; commands: string[] } {
  const dir = waveWorkdir(input.workKey);
  const prefix = `cd ${dir} && `;
  const sync = syncForkCommands({ upstream: input.upstream, forkRemote: 'origin', base: input.base, branch: input.branch });
  return {
    dir,
    commands: [
      `rm -rf ${dir}`,
      `git clone ${input.forkRepo} ${dir}`,
      ...sync.map(c => prefix + c),
    ],
  };
}
