/**
 * aialm-oss-adapter — thin GitHub REST v3 seam (read path for onboard/discover).
 *
 * Skille nie zawierają surowych wywołań API — wszystko idzie przez adapter.
 * Odczyty działają na publicznych repozytoriach bez tokena (limit 60 req/h);
 * token wymagany dopiero przy zapisach (fork/PR — osobne skille).
 */
import { loadDotEnv } from './config.js';

export class GithubError extends Error {
  constructor(
    public status: number,
    public path: string,
    detail: string,
  ) {
    super(`GitHub ${status} ${path}: ${detail}`);
    this.name = 'GithubError';
  }
}

export interface GithubClientOptions {
  fetchImpl?: typeof fetch;
  token?: string;
}

export interface RepoInfo {
  full_name: string;
  default_branch: string;
  fork: boolean;
  html_url: string;
  language?: string | null;
}

export interface ContentsEntry {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  name: string;
  path: string;
}

export interface IssueRef {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: { name: string }[];
  user?: { login: string };
  created_at?: string;
}

export class GithubClient {
  private static API = 'https://api.github.com';
  private readonly f: typeof fetch;
  private readonly token: string;

  constructor(opts: GithubClientOptions = {}) {
    loadDotEnv();
    this.token = opts.token ?? process.env.GITHUB_TOKEN?.trim() ?? '';
    this.f = opts.fetchImpl ?? ((u, i) => fetch(u as never, i));
  }

  private async req<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    opts: { accept?: string; body?: unknown } = {},
  ): Promise<{ status: number; data: T; rawText: string }> {
    const accept = opts.accept ?? 'application/vnd.github+json';
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-alm-oss',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await this.f(`${GithubClient.API}${path}`, init);
    const text = await res.text();
    if (!res.ok) {
      const msg = (() => {
        try {
          return (JSON.parse(text) as { message?: string }).message ?? text.slice(0, 200);
        } catch {
          return text.slice(0, 200);
        }
      })();
      throw new GithubError(res.status, path, msg);
    }
    const data =
      text && accept !== 'application/vnd.github.raw' ? (JSON.parse(text) as T) : (text as T);
    return { status: res.status, data, rawText: text };
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    return (await this.req('GET', `/repos/${owner}/${repo}`)).data as RepoInfo;
  }

  /** Fetch a raw-encoded text file from default branch (or explicit ref). */
  async getFile(owner: string, repo: string, path: string, ref?: string): Promise<string | undefined> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    try {
      const r = await this.req('GET', `/repos/${owner}/${repo}/contents/${path.replace(/^\//, '')}${q}`);
      const d = r.data as { encoding?: string; content?: string };
      if (d.encoding === 'base64' && d.content) {
        return Buffer.from(d.content, 'base64').toString('utf8');
      }
      return undefined;
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return undefined;
      throw e;
    }
  }

  /** List a directory (top-level or nested) via git trees API. */
  async listDir(owner: string, repo: string, path = '', ref?: string): Promise<ContentsEntry[]> {
    const branch = ref ?? (await this.getRepo(owner, repo)).default_branch;
    const tree = (await this.req('GET', `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`)).data as {
      tree?: Array<{ type: string; path: string }>;
      truncated?: boolean;
    };
    const base = path.replace(/\/$/, '');
    const prefix = base ? `${base}/` : '';
    return (tree.tree ?? [])
      .filter(e => (base ? e.path.startsWith(prefix) && e.path !== base : !e.path.includes('/')))
      .map(e => ({
        type: (e.type === 'blob' ? 'file' : e.type === 'tree' ? 'dir' : e.type) as ContentsEntry['type'],
        name: e.path.split('/').pop() ?? e.path,
        path: e.path,
      }));
  }

  /** Open non-PR issues (paginated). */
  async listOpenIssues(owner: string, repo: string, maxPages = 10): Promise<IssueRef[]> {
    const out: IssueRef[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.req('GET', `/repos/${owner}/${repo}/issues?state=open&per_page=50&page=${page}`);
      const list = r.data as IssueRef[];
      out.push(...list.filter(x => !('pull_request' in x)));
      if (list.length < 50) break;
    }
    return out;
  }

  /** Read `.github/workflows` text files and next the `run:` lines (CI commands). */
  async collectWorkflowCommands(owner: string, repo: string, ref?: string): Promise<string[]> {
    const dir = await this.listDir(owner, repo, '.github/workflows', ref).catch(() => []);
    const files = dir.filter(e => e.type === 'file' && e.name.endsWith('.yml') || e.name.endsWith('.yaml'));
    const commands = new Set<string>();
    for (const file of files) {
      const text = await this.getFile(owner, repo, file.path, ref);
      if (!text) continue;
      for (const line of text.split('\n')) {
        const run = /^\s*-\s*run:\s*(.+?)\s*$/.exec(line);
        if (!run) continue;
        const cmd = run[1]!.trim();
        if (!cmd) continue;
        // Skip pure echo commands (debug noise); skip git mutations / package
        // install house-keeping which are not validation signals for the AI profile.
        if (/^(echo|git push|git add|git commit|git config)\b/i.test(cmd)) continue;
        if (/^npm (ci|i|install)\b/i.test(cmd)) continue;
        commands.add(cmd);
      }
    }
    return [...commands];
  }
}