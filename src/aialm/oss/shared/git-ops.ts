/**
 * aialm-oss-shared — git-ops helpers for dev-impl / wave isolation.
 *
 * Fork/branch/push are SKILL.md instructions for the LLM agent; this module
 * provides the deterministic, testable helpers that the agent should call via
 * `shared/git-ops` instead of building raw `https://${GITHUB_TOKEN}@github.com/...`
 * strings ad-hoc. The agent still owns orchestration (decides what to write),
 * these helpers own the mechanical git I/O and token handling.
 *
 * All helpers are pure except `ensureFork` (GitHub REST) — no shell spawning
 * here so tests stay deterministic. Shell snippets are documented for the
 * skill to `exec` inside the container where `git` + `GITHUB_TOKEN` are
 * available (`dispatcher` mounts `.env` + `.git`).
 */

import { GithubClient, GithubError } from '../adapter/github.js';

const WAVE_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

/** Normalized wave key: lower-cased issue key (`WELLBEINGT-5` → `wellbeingt-5`). */
export function waveKeyFor(issueKey: string): string {
  const k = issueKey.trim();
  if (!WAVE_KEY_RE.test(k)) throw new Error(`invalid issue key: ${issueKey}`);
  return k.toLowerCase();
}

/** Feature branch for a wave: `aialm/<waveKey>` (e.g. `aialm/wellbeingt-5`). */
export function branchForWave(issueKey: string): string {
  return `aialm/${waveKeyFor(issueKey)}`;
}

/** Isolated clone dir for a wave: `.work/<waveKey>` (or `<baseDir>/<waveKey>`). */
export function workDirFor(issueKey: string, baseDir = '.work'): string {
  const key = waveKeyFor(issueKey);
  const base = baseDir.replace(/\/$/, '');
  return `${base}/${key}`;
}

/** `https://x-access-token:<token>@github.com/<owner>/<repo>.git` for push. */
export function httpsPushUrl(owner: string, repo: string, token: string): string {
  const o = owner.trim();
  const r = repo.trim();
  const t = token.trim();
  if (!o) throw new Error('httpsPushUrl: owner required');
  if (!r) throw new Error('httpsPushUrl: repo required');
  if (!t) throw new Error('httpsPushUrl: token required');
  // Use x-access-token prefix so GitHub treats it as a PAT (avoids username confusion).
  return `https://x-access-token:${encodeURIComponent(t)}@github.com/${o}/${r}.git`;
}

/** Redact token from a push URL for logs (`***`). */
export function redactedPushUrl(url: string): string {
  return url.replace(/:\/\/[^@]+@/, '://***@');
}

/** Args for `git clone <url> <dir>` — caller redacts url for logging. */
export function cloneArgs(pushUrl: string, workDir: string): string[] {
  return ['clone', pushUrl, workDir];
}

/** Args for `git -C <dir> checkout -B <branch>` (idempotent branch create/reset). */
export function checkoutArgs(workDir: string, branch: string): string[] {
  return ['-C', workDir, 'checkout', '-B', branch];
}

/**
 * Ensure the authenticated user has a fork of `owner/repo`. Idempotent:
 * - 202 Accepted → fork creation queued (poll not needed for push; GitHub creates on demand).
 * - 422 / "already forked" → treated as success (fork already exists).
 *
 * Returns the fork owner (authenticated user) + html_url. Uses `GithubClient`
 * so token / fetchImpl injection works the same as the read path.
 */
export async function ensureFork(
  owner: string,
  repo: string,
  opts: { client?: GithubClient; token?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ forkOwner: string; htmlUrl: string }> {
  const client =
    opts.client ??
    new GithubClient({
      ...(opts.token !== undefined ? { token: opts.token } : {}),
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    });
  // Probe who we are so we know fork owner for push URL.
  // If /user fails (no token / rate limit) we fall back to owner as push target.
  let forkOwner = owner;
  try {
    const me = await (client as unknown as { req: <T>(m: string, p: string) => Promise<{ data: T }> }).req<{ login: string }>(
      'GET' as never,
      '/user' as never,
    );
    if (me?.data?.login) forkOwner = me.data.login;
  } catch {
    // ignore — forkOwner stays as upstream owner
  }

  try {
    const res = await (client as unknown as { req: <T>(m: string, p: string, o?: unknown) => Promise<{ data: T }> }).req<{
      html_url?: string;
      owner?: { login?: string };
      full_name?: string;
    }>('POST' as never, `/repos/${owner}/${repo}/forks` as never, {
      body: { default_branch_only: true },
    });
    const url = res?.data?.html_url ?? `https://github.com/${forkOwner}/${repo}`;
    const ownerLogin = res?.data?.owner?.login ?? forkOwner;
    return { forkOwner: ownerLogin, htmlUrl: url };
  } catch (e) {
    if (e instanceof GithubError && e.status === 422) {
      // Already forked — treat as success.
      return { forkOwner, htmlUrl: `https://github.com/${forkOwner}/${repo}` };
    }
    // 202 is success in some GitHub configs but our client throws on non-2xx;
    // rethrow otherwise.
    throw e;
  }
}
