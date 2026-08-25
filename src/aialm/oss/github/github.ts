import { githubConfig } from '../shared/config.ts';

export class GithubError extends Error {
  constructor(
    public status: number,
    public path: string,
    public detail: string,
  ) {
    super(`GitHub ${status} ${path}: ${detail}`);
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

export interface IssueRef {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  html_url: string;
  user?: { login: string };
  comments?: number;
  created_at?: string;
}

/**
 * GitHub REST seam (aialm-oss-adapter). Token-based; no gh CLI dependency.
 * Read paths work on any public repo; write paths require rights (own repos or forks).
 */
export class GithubClient {
  private readonly f: typeof fetch;
  private readonly token: string;
  private static API = 'https://api.github.com';

  constructor(opts: GithubClientOptions = {}) {
    this.token = opts.token ?? githubConfig().token;
    this.f = opts.fetchImpl ?? ((u, i) => fetch(u as any, i));
  }

  private async req<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    accept = 'application/vnd.github+json',
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-alm-oss',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
    // Unauthenticated reads work for public repos (60 req/h limit); token required for writes.
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.f(`${GithubClient.API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = {};
    if (text && accept !== 'application/vnd.github.raw') data = JSON.parse(text);
    else if (text) data = text as any;
    if (!res.ok) {
      const detail =
        (data as any)?.message ?? (typeof data === 'string' ? data.slice(0, 200) : text.slice(0, 200));
      throw new GithubError(res.status, path, String(detail));
    }
    return { status: res.status, data };
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    return (await this.req('GET', `/repos/${owner}/${repo}`)).data as RepoInfo;
  }

  /** The authenticated account (requires a token). */
  async me(): Promise<{ login: string; id?: number }> {
    return (await this.req('GET', '/user')).data as { login: string; id?: number };
  }

  async listOpenIssues(owner: string, repo: string, maxPages = 10): Promise<IssueRef[]> {
    const out: IssueRef[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.req(
        'GET',
        `/repos/${owner}/${repo}/issues?state=open&per_page=50&page=${page}`,
      );
      const list = r.data as any[];
      out.push(...list.filter((x) => !('pull_request' in x)));
      if (list.length < 50) break;
    }
    return out;
  }

  async getIssue(owner: string, repo: string, n: number): Promise<IssueRef> {
    return (await this.req('GET', `/repos/${owner}/${repo}/issues/${n}`)).data as IssueRef;
  }

  async listIssueComments(owner: string, repo: string, n: number): Promise<
    { id: number; user: { login: string }; body: string; created_at: string }[]
  > {
    return (await this.req('GET', `/repos/${owner}/${repo}/issues/${n}/comments?per_page=100`)).data;
  }

  /** Fetch a file's raw content; returns null on 404. */
  async getFile(owner: string, repo: string, path: string, ref?: string): Promise<string | null> {
    try {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const r = await this.req(
        'GET',
        `/repos/${owner}/${repo}/contents/${encodeURI(path)}${q}`,
        undefined,
        'application/vnd.github.raw',
      );
      return typeof r.data === 'string' ? r.data : null;
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return null;
      throw e;
    }
  }

  /** List immediate children (file names) of a directory path; throws 404 if missing. */
  async listDir(owner: string, repo: string, path: string): Promise<string[]> {
    const r = await this.req('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}`);
    const list = r.data as any[];
    if (!Array.isArray(list)) throw new GithubError(200, path, 'not a directory');
    return list.filter(x => x.type === 'file').map((x: any) => x.name as string);
  }

  /** Latest GitHub Actions workflow runs (public repos readable without auth). */
  async listActionsRuns(owner: string, repo: string, branch?: string): Promise<any[]> {
    const q = branch
      ? `?branch=${encodeURIComponent(branch)}&per_page=5&status=completed`
      : '?per_page=5&status=completed';
    return ((await this.req('GET', `/repos/${owner}/${repo}/actions/runs${q}`)).data as any).workflow_runs ?? [];
  }

  /** Fetch job-level outcomes of a run (for per-job unit/e2e reporting). */
  async getActionsRunJobs(owner: string, repo: string, runId: number): Promise<any[]> {
    return ((await this.req('GET', `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)).data as any).jobs ?? [];
  }

  async fork(owner: string, repo: string): Promise<RepoInfo> {
    const r = await this.req('POST', `/repos/${owner}/${repo}/forks`);
    return r.data as RepoInfo;
  }

  /** Ensure a fork exists for the authenticated account; returns the fork repo info. */
  async ensureFork(owner: string, repo: string): Promise<RepoInfo> {
    // If the authenticated user already has a fork, POST /forks returns 422; GET first.
    try {
      const me = await this.req('GET', '/user');
      const login = (me.data as any).login as string;
      const existing = await this.req('GET', `/repos/${login}/${repo}`);
      const d = existing.data as RepoInfo;
      if (d.fork && d.full_name === `${login}/${repo}`) return d;
    } catch {
      /* no existing usable fork — create it */
    }
    return this.fork(owner, repo);
  }

  /** HTTPS push URL for a fork/branch using a token (no SSH key required). */
  httpsPushUrl(owner: string, repo: string, token: string): string {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}`;
  }

  /** Create branch `branch` at the head of `fromBranch` (default repo default). */
  async createBranch(owner: string, repo: string, branch: string, fromBranch?: string): Promise<void> {
    const base = fromBranch ?? (await this.getRepo(owner, repo)).default_branch;
    const ref = await this.req('GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
    const sha = (ref.data as any).object.sha as string;
    await this.req('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  /** Create/replace a single file via Contents API (MVP commit mechanism). */
  async putFile(input: {
    owner: string;
    repo: string;
    path: string;
    branch: string;
    message: string;
    content: string; // utf-8
  }): Promise<{ sha: string }> {
    let existingSha: string | undefined;
    try {
      const cur = await this.req(
        'GET',
        `/repos/${input.owner}/${input.repo}/contents/${encodeURI(input.path)}?ref=${encodeURIComponent(input.branch)}`,
      );
      existingSha = (cur.data as any).sha;
    } catch (e) {
      if (!(e instanceof GithubError && e.status === 404)) throw e;
    }
    const r = await this.req('PUT', `/repos/${input.owner}/${input.repo}/contents/${encodeURI(input.path)}`, {
      message: input.message,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      branch: input.branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });
    return { sha: (r.data as any).content.sha };
  }

  async createPullRequest(input: {
    owner: string;
    repo: string;
    title: string;
    head: string; // "user:branch" for cross-repo PRs
    base: string;
    body: string;
    draft?: boolean;
  }): Promise<{ number: number; html_url: string }> {
    const r = await this.req('POST', `/repos/${input.owner}/${input.repo}/pulls`, {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: input.draft ?? false,
    });
    return r.data as { number: number; html_url: string };
  }
}
