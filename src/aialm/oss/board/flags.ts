import { deriveProjectKey } from '../onboard/provision.ts';

/** CLI flags and URL helpers for the board/pipeline scripts (pure, testable). */

/** Default location of the captured Playwright login session. */
export const DEFAULT_SESSION_PATH = '.state/jira-session.json';

/** Split `owner/name` into its parts. Throws when there is no `/`. */
export function parseRepoRef(repo: string): { owner: string; repo: string } {
  const [owner, name, ...rest] = repo.split('/');
  if (!owner || !name || rest.length) throw new Error(`Expected repo as "owner/name", got "${repo}"`);
  return { owner, repo: name };
}

/** Project key derived deterministically from a `owner/name` repo ref. */
export function repoKey(repo: string): string {
  return deriveProjectKey(parseRepoRef(repo).repo);
}

export interface ProvisionArgs {
  dry: boolean;
  repo: string;
}

/**
 * Parse CLI flags for board:create (REST-only statuses). Supports both
 * `--key=value` and bare boolean flags (`--dry`).
 */
export function parseProvisionArgs(argv: readonly string[]): ProvisionArgs {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
    else if (a === '--dry') out.dry = '1';
  }
  return { dry: out.dry === '1', repo: out.repo ?? '' };
}

export interface SessionArgs {
  dry: boolean;
  headless: boolean;
  session: string;
  repo: string;
}

/**
 * Parse CLI flags for board:session (capture login session). Supports
 * `--key=value` and bare `--dry`. Defaults: headless=true, session=DEFAULT.
 */
export function parseSessionArgs(argv: readonly string[]): SessionArgs {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
    else if (a === '--dry') out.dry = '1';
  }
  return {
    dry: out.dry === '1',
    headless: (out.headless ?? 'true') !== 'false',
    session: out.session ?? DEFAULT_SESSION_PATH,
    repo: out.repo ?? '',
  };
}

export interface ColumnsArgs {
  dry: boolean;
  headless: boolean;
  session: string;
  repo: string;
}

/**
 * Parse CLI flags for board:columns (UI column layout). Supports `--key=value`
 * and bare `--dry`. Defaults: headless=true, session=DEFAULT.
 */
export function parseColumnsArgs(argv: readonly string[]): ColumnsArgs {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
    else if (a === '--dry') out.dry = '1';
  }
  return {
    dry: out.dry === '1',
    headless: (out.headless ?? 'true') !== 'false',
    session: out.session ?? DEFAULT_SESSION_PATH,
    repo: out.repo ?? '',
  };
}

/** True when a URL is still inside the Atlassian identity (SSO/home) flow. */
export function isOnIdAtlassian(url: string): boolean {
  return url.includes('id.atlassian.com');
}

/** True when a URL is on an actual board page (`/boards/123`). */
export function isBoardUrl(url: string): boolean {
  return /\/boards\/\d+/.test(url);
}
