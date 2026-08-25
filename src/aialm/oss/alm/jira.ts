import { jiraConfig } from '../shared/config.ts';
import { assertAiCommentSafe } from '../shared/ai-comment.ts';

/** Minimal ADF document type (structural only). */
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: unknown[];
}

export function asAdf(node: unknown): AdfDoc {
  const d = node as AdfDoc;
  if (!d || d.type !== 'doc') throw new Error('Not an ADF doc');
  return d;
}

export function adfToPlainText(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToPlainText).join('');
  let out = '';
  if (typeof node.text === 'string') out += node.text;
  if (node.type === 'emoji' && typeof node.attrs?.text === 'string') out += node.attrs.text;
  if (node.type === 'hardBreak' || node.type === 'blockquote') out += '\n';
  if (node.type === 'codeBlock') out += '\n';
  if (Array.isArray(node.content)) out += node.content.map(adfToPlainText).join('');
  return out;
}

export interface JiraComment {
  id: string;
  authorId?: string;
  bodyAdf: unknown;
  bodyText: string;
  created?: string;
}

export interface JiraIssueRef {
  key: string;
  id: string;
  summary?: string;
}

export class JiraError extends Error {
  constructor(
    public status: number,
    public path: string,
    public detail: string,
  ) {
    super(`Jira ${status} ${path}: ${detail}`);
  }
}

export interface JiraClientOptions {
  fetchImpl?: typeof fetch;
  config?: ReturnType<typeof jiraConfig>;
}

/**
 * Thin Jira Cloud REST v3 seam (aialm-oss-adapter).
 * All ALM access must go through this client — skills contain zero raw API calls.
 */
export class JiraClient {
  private readonly base: string;
  private readonly auth: string;
  private readonly f: typeof fetch;

  constructor(opts: JiraClientOptions = {}) {
    const cfg = opts.config ?? jiraConfig();
    this.base = cfg.site.replace(/\/$/, '');
    this.auth = `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;
    this.f = opts.fetchImpl ?? ((u, i) => fetch(u as any, i));
  }

  private async req<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const res = await this.f(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: this.auth,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    if (!res.ok && res.status !== 204) {
      const detail =
        (data as any)?.errorMessages?.join('; ') ??
        (data as any)?.errors
          ? JSON.stringify((data as any).errors)
          : text.slice(0, 300);
      throw new JiraError(res.status, path, typeof detail === 'string' ? detail : text.slice(0, 300));
    }
    return { status: res.status, data };
  }

  async myself(): Promise<{ accountId: string; emailAddress?: string }> {
    return (await this.req('GET', '/rest/api/3/myself')).data;
  }

  async getIssue(
    key: string,
    fields: string[] = ['summary', 'description', 'labels', 'parent', 'issuetype'],
  ): Promise<any> {
    return (
      await this.req('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(',')}`)
    ).data;
  }

  async createIssue(fields: Record<string, unknown>): Promise<JiraIssueRef> {
    return (
      await this.req('POST', '/rest/api/3/issue', { fields })
    ).data as JiraIssueRef;
  }

  async updateIssue(key: string, fields: Record<string, unknown>): Promise<void> {
    await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
  }

  /** Clear the assignee (assignee-hygiene after an automated gate-consuming step). */
  async unassign(issueKey: string): Promise<void> {
    await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`, {});
  }

  /** Assign an issue to a specific account (role-based approver before a gate). */
  async assign(issueKey: string, accountId: string): Promise<void> {
    await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`, { accountId });
  }

  /** Available statuses for each issue type in a project (board column mapping). */
  async getProjectStatuses(issueKey: string): Promise<{ name: string; id: string }[]> {
    const key = issueKey.split('-')[0]!;
    const r = await this.req('GET', `/rest/api/3/project/${encodeURIComponent(key)}/statuses`);
    const types = r.data as any[];
    const task = types.find(t => t.name === 'Task') ?? types[0] ?? {};
    return ((task.statuses ?? []) as any[]).map(s => ({ name: s.name as string, id: String(s.id) }));
  }

  /** Available workflow transitions for an issue. */
  async getTransitions(issueKey: string): Promise<{ id: string; name: string; to?: { name?: string; id?: string } }[]> {
    const r = await this.req('GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
    return (((r.data as any).transitions ?? []) as any[]).map(t => ({
      id: String(t.id),
      name: t.name as string,
      to: t.to ? { name: t.to.name as string, id: t.to.id ? String(t.to.id) : undefined } : undefined,
    }));
  }

  /** Perform a workflow transition by transition id. */
  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: transitionId },
    });
  }

  async addComment(issueKey: string, adf: unknown): Promise<{ id: string }> {
    const r = await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      body: adf,
    });
    return { id: String((r.data as any).id) };
  }

  /**
   * Mandated writer for AI-authored comments. Refuses to post any text that is
   * not marked `[AI-generated]` — guards the approval channel against a future
   * automation step silently stealing the human approver role.
   */
  async addAiComment(issueKey: string, adf: unknown): Promise<{ id: string }> {
    assertAiCommentSafe(adfToPlainText(adf));
    return this.addComment(issueKey, adf);
  }

  async listComments(issueKey: string): Promise<JiraComment[]> {
    const r = await this.req('GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`);
    const list = (r.data as any).comments ?? [];
    return list.map((c: any) => ({
      id: String(c.id),
      authorId: c.author?.accountId,
      bodyAdf: c.body,
      bodyText: adfToPlainText(c.body),
      created: c.created,
    }));
  }

  /** Search with nextPageToken pagination (modern /search/jql endpoint). */
  async searchJql(jql: string, fields: string[], maxPer = 100): Promise<any[]> {
    const issues: any[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = { jql, fields, maxResults: maxPer };
      if (token) body.nextPageToken = token;
      const r = await this.req('POST', '/rest/api/3/search/jql', body);
      issues.push(...((r.data as any).issues ?? []));
      token = (r.data as any).nextPageToken;
    } while (token);
    return issues;
  }

  async createKanbanProject(input: {
    key: string;
    name: string;
    description?: string;
    leadAccountId: string;
  }): Promise<{ id: string; key: string }> {
    return (
      await this.req('POST', '/rest/api/3/project', {
        key: input.key,
        name: input.name,
        projectTypeKey: 'software',
        projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-kanban-template',
        description: input.description ?? '',
        leadAccountId: input.leadAccountId,
        assigneeType: 'PROJECT_LEAD',
      })
    ).data as { id: string; key: string };
  }

  async getProject(key: string): Promise<any> {
    return (await this.req('GET', `/rest/api/3/project/${encodeURIComponent(key)}`)).data;
  }

  async projectExists(key: string): Promise<boolean> {
    try {
      await this.getProject(key);
      return true;
    } catch (e) {
      if (e instanceof JiraError && e.status === 404) return false;
      throw e;
    }
  }

  async addRemoteLink(issueKey: string, link: { url: string; title: string }): Promise<{ id: string }> {
    const r = await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`, {
      object: { url: link.url, title: link.title },
    });
    return { id: String((r.data as any).id) };
  }

  // ---- user & access management (AccessGrant mechanics) ----

  async findUserByEmail(email: string): Promise<{ accountId: string } | null> {
    const r = await this.req(
      'GET',
      `/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=1`,
    );
    const users = r.data as any[];
    return users.length ? { accountId: users[0]!.accountId } : null;
  }

  /** Invite a new user to the site (required before role grant). Idempotent-ish: 400 on duplicate tolerated by caller. */
  async inviteUser(email: string): Promise<{ accountId?: string }> {
    const r = await this.req('POST', '/rest/api/3/user', {
      email,
      products: ['jira-software'],
    });
    return { accountId: (r.data as any).accountId };
  }

  async getProjectRoles(projectKey: string): Promise<Record<string, { id: number; name: string }>> {
    return (await this.req('GET', `/rest/api/3/project/${encodeURIComponent(projectKey)}/role`)) as any;
  }

  /** Add a user to a project role (e.g. "Users" ⇒ browse under default scheme). */
  async addProjectRoleActor(projectKey: string, roleId: number, accountId: string): Promise<void> {
    await this.req(
      'POST',
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/role/${roleId}`,
      { user: [accountId] },
    );
  }
}
