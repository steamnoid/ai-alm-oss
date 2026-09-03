/**
 * aialm-oss-adapter — thin Jira Cloud REST v3 seam.
 *
 * Wszystkie odczyty/zapisy ALM idą przez ten klient — skille nie wolno
 * zawierać surowych wywołań API. NIGDY Plane.
 */
import type { TicketState } from '../shared/state.js';
import { IMMUTABLE_STATUS_LABEL_PREFIX, stateLabels } from '../shared/state.js';
import { proposalHeader } from '../shared/identity.js';
import type { CommentLike, Reaction } from '../shared/approval.js';
import { isAiMarked } from '../shared/identity.js';
import { markdownToAdf, adfToPlainText } from './adf.js';
import type { JiraConfig } from './config.js';

export class JiraError extends Error {
  public readonly detail: string;
  constructor(
    public status: number,
    public path: string,
    detail: string,
  ) {
    super(`Jira ${status} ${path}: ${detail}`);
    this.name = 'JiraError';
    this.detail = detail;
  }
}

export interface JiraClientOptions {
  fetchImpl?: typeof fetch;
  config?: JiraConfig;
}

export interface IssueKind {
  id: string;
  key: string;
}

/** Minimal shape of a Jira custom field (from /rest/api/3/field). */
export interface CustomFieldInfo {
  id: string; // customfield_NNNNN
  name: string;
  custom: boolean;
  schema?: { type?: string; custom?: string; customId?: number };
}

export class JiraClient {
  private readonly base: string;
  private readonly auth: string;
  private readonly f: typeof fetch;

  constructor(opts: JiraClientOptions = {}) {
    const cfg: JiraConfig =
      opts.config ?? { site: '', email: '', token: '' }; // caller supplies env config
    this.base = cfg.site.replace(/\/$/, '');
    this.auth = `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;
    this.f = opts.fetchImpl ?? ((u, i) => fetch(u as never, i));
  }

  private async req<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: this.auth,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.f(`${this.base}${path}`, init);
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    if (!res.ok && res.status !== 204) {
      const errData = data as { errorMessages?: string[]; errors?: Record<string, unknown> };
      const detail =
        (errData.errorMessages?.length ? errData.errorMessages.join('; ') : '') ||
        (errData.errors && Object.keys(errData.errors).length ? JSON.stringify(errData.errors) : '') ||
        text.slice(0, 300);
      throw new JiraError(res.status, path, detail);
    }
    return data;
  }

  /** Konto, którym wykonuje operacje (gate assignee: AI ALM OSS). */
  async myself(): Promise<{ accountId: string; emailAddress?: string }> {
    return this.req('GET', '/rest/api/3/myself') as Promise<{ accountId: string; emailAddress?: string }>;
  }

  /** Get issue with a set of fields (JSON), or full issue object. */
  async getIssue(key: string, fields?: readonly string[]): Promise<Record<string, unknown>> {
    const q = fields?.length ? `?fields=${fields.join(',')}` : '';
    return this.req('GET', `/rest/api/3/issue/${encodeURIComponent(key)}${q}`) as Promise<
      Record<string, unknown>
    >;
  }

  /** Update select custom fields (self-aware krotka) by resolved CID map. */
  async updateState(
    key: string,
    state: TicketState,
    cids: { stage?: string; role?: string; agent?: string },
  ): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (cids.stage) fields[cids.stage] = { value: state.stage };
    if (cids.role) fields[cids.role] = state.role ? { value: state.role } : null;
    if (cids.agent) fields[cids.agent] = { value: state.agent };
    if (Object.keys(fields).length > 0) {
      // Right after create, Jira may temporarily 404 on the fresh key
      // (index eventual-consistency). Retry a few times with backoff.
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
          break;
        } catch (e) {
          const isTransient404 = e instanceof JiraError && e.status === 404;
          if (!isTransient404 || attempt === maxAttempts) throw e;
          await this.sleep(300 * attempt);
        }
      }
    }
    await this.syncStateLabels(key, state);
  }

  /** Current full label set of an issue. */
  async getLabels(key: string): Promise<string[]> {
    const issue = (await this.getIssue(key, ['labels'])) as { fields?: { labels?: string[] } };
    return issue?.fields?.labels ?? [];
  }

  /** Replace the full label set (rewrite to drop/remove specific labels). */
  async setLabels(key: string, labels: string[]): Promise<void> {
    await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, {
      fields: { labels },
    });
  }

  /**
   * Utrzymuj labele statusowe w zgodzie z krotką: usuwamy wszystkie nasze
   * `aialm:*` labela, których nie ma w bieżącym żądanym zestawie, i dodajemy
   * te żądane. Idempotentne (nie zależy od poprzedniego stanu).
   * Labele `aialm:debug:*` są per-ticket governance flagą DEBUG (default ON)
   * i są ZAWSZE zachowywane — nigdy nie usuwane przez sync.
   */
  private async syncStateLabels(key: string, state: TicketState): Promise<void> {
    const wanted = new Set(stateLabels(state));
    const current = (await this.getIssue(key, ['labels'])) as {
      fields?: { labels?: string[] };
    };
    const currentLabels = current?.fields?.labels ?? [];
    const isDebugLabel = (l: string) => l.startsWith('aialm:debug:');
    const debugLabels = currentLabels.filter(isDebugLabel);
    const pristine = currentLabels.filter(l => !l.startsWith(IMMUTABLE_STATUS_LABEL_PREFIX));
    const keptOwned = currentLabels.filter(
      l => l.startsWith(IMMUTABLE_STATUS_LABEL_PREFIX) && !isDebugLabel(l) && wanted.has(l),
    );
    // Dedupe debug + wanted + kept + pristine
    const seen = new Set<string>();
    const next: string[] = [];
    for (const l of [...wanted, ...debugLabels, ...keptOwned, ...pristine]) {
      if (!seen.has(l)) {
        seen.add(l);
        next.push(l);
      }
    }
    const same =
      next.length === currentLabels.length && next.every((v, i) => v === currentLabels[i]);
    // Porównanie zbiorów (kolejność może się różnić) — użyj sort dla stabilności
    const sameSet =
      next.length === currentLabels.length && next.every(l => currentLabels.includes(l));
    if (!sameSet) {
      await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, {
        fields: { labels: next },
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Add a comment (ADF) via REST v3. */
  async addComment(key: string, bodyAdf: unknown): Promise<{ id: string }> {
    return this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      body: bodyAdf,
    }) as Promise<{ id: string }>;
  }

  /** Convenience: add a marked proposal comment, returns proposal header too. */
  async addProposalComment(
    key: string,
    skill: string,
    proposalId: string,
    markdownBody: string,
  ): Promise<{ commentId: string; header: string }> {
    const header = proposalHeader(key, skill, proposalId);
    const { id } = await this.addComment(key, markdownToAdf(`${header}\n\n${markdownBody}`));
    return { commentId: id, header };
  }

  /**
   * List issue comments shaped for approval detection. `isAi` per comment =
   * author matches the authenticated AI ALM OSS account OR the comment carries
   * the `[AI-generated]` marker (tolerant). Reactions map to `{emoji, isAi}`.
   */
  async listComments(key: string): Promise<CommentLike[]> {
    const d = (await this.req(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
    )) as {
      comments?: Array<{
        id: string;
        author?: { accountId?: string } | null;
        body?: unknown;
        reactions?: Array<{ emoji?: string; author?: { accountId?: string } | null }>;
      }>;
    };
    const me = await this.myself();
    const aiAccountId = me.accountId;
    return (d.comments ?? []).map(c => {
      const bodyText = adfToPlainText(c.body);
      const reactions: Reaction[] = [];
      for (const r of c.reactions ?? []) {
        const emoji = r.emoji ?? '';
        if (!emoji) continue;
        reactions.push({ emoji, isAi: c.author?.accountId === aiAccountId });
      }
      return {
        body: bodyText,
        isAi: c.author?.accountId === aiAccountId || isAiMarked(bodyText),
        reactions,
      };
    });
  }

  /** JQL search returning issue objects with `key` (and optional extra fields). */
  async searchJql(
    jql: string,
    fields?: readonly string[],
    maxResults = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const body: Record<string, unknown> = { jql, maxResults };
    if (fields?.length) body.fields = fields as unknown as string[];
    const data = (await this.req('POST', '/rest/api/3/search/jql', body)) as {
      issues?: Array<Record<string, unknown>>;
    };
    return data.issues ?? [];
  }

  /** Get project by key (throws JiraError if missing). */
  async getProject(key: string): Promise<{ key: string; name: string }> {
    const p = (await this.req('GET', `/rest/api/3/project/${encodeURIComponent(key)}`)) as {
      key: string;
      name: string;
    };
    return { key: p.key, name: p.name };
  }

  /** List all projects (key + name), for name-based resolution. */
  async listProjects(): Promise<Array<{ key: string; name: string }>> {
    const d = (await this.req(
      'GET',
      '/rest/api/3/project/search?maxResults=200',
    )) as { values?: Array<{ key: string; name: string }> };
    const out = d.values ?? [];
    let startAt = out.length;
    for (;;) {
      const page = (await this.req(
        'GET',
        `/rest/api/3/project/search?startAt=${startAt}&maxResults=200`,
      )) as { values?: Array<{ key: string; name: string }>; isLast?: boolean };
      const batch = page.values ?? [];
      out.push(...batch);
      if (page.isLast || batch.length === 0) break;
      startAt += batch.length;
    }
    return out;
  }

  /** Whether a project with this key exists. */
  async projectExists(key: string): Promise<boolean> {
    try {
      await this.getProject(key);
      return true;
    } catch (e) {
      if (e instanceof JiraError && e.status === 404) return false;
      throw e;
    }
  }

  /** Map an issue type NAME to its id within a project (epic/story/task…). */
  async issueTypeId(projectKey: string, name: string): Promise<string> {
    const proj = (await this.req('GET', `/rest/api/3/project/${encodeURIComponent(projectKey)}`)) as {
      issueTypes?: Array<{ id: string; name: string }>;
    };
    const found = proj.issueTypes?.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error(`Issue type "${name}" not found in project ${projectKey}`);
    return found.id;
  }

  /** Create an issue (fields map). Returns key + id. */
  async createIssue(fields: Record<string, unknown>): Promise<IssueKind> {
    const d = (await this.req('POST', '/rest/api/3/issue', { fields })) as IssueKind;
    return { id: d.id, key: d.key };
  }

  /** Create a company-managed (classic) Kanban project (private by default). */
  async createProject(input: {
    key: string;
    name: string;
    leadAccountId: string;
    description?: string;
  }): Promise<{ key: string; id: string }> {
    const body = {
      key: input.key,
      name: input.name,
      leadAccountId: input.leadAccountId,
      projectTypeKey: 'software',
      // CLASSIC (company-managed): our-self-aware screens są API-manageable.
      // (next-gen `gh-simplified-*` nie pozwala sterować screenami via REST.)
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-kanban-template',
      assigneeType: 'PROJECT_LEAD',
      ...(input.description ? { description: input.description } : {}),
    };
    const d = (await this.req('POST', '/rest/api/3/project', body)) as { key: string; id: string };
    return { key: d.key, id: d.id };
  }

  // ---- Custom fields (self-aware per-klient) ----

  /** Lists all fields; filters to custom where `custom===true`. */
  async listCustomFields(): Promise<CustomFieldInfo[]> {
    const all = (await this.req('GET', '/rest/api/3/field')) as CustomFieldInfo[];
    return all.filter(f => f.custom);
  }

  /** Lists ALL fields (including non-custom), for robust name matching. */
  async listAllFields(): Promise<CustomFieldInfo[]> {
    return (await this.req('GET', '/rest/api/3/field')) as CustomFieldInfo[];
  }

  /** Create a select custom field. `searcherKey` must match the type (see docs). */
  async createCustomField(input: {
    name: string;
    description?: string;
    type: string; // full value, e.g. com.atlassian.jira.plugin.system.customfieldtypes:select
    searcherKey: string;
  }): Promise<CustomFieldInfo> {
    const body: Record<string, unknown> = {
      name: input.name,
      type: input.type,
      searcherKey: input.searcherKey,
      ...(input.description ? { description: input.description } : {}),
    };
    return this.req('POST', '/rest/api/3/field', body) as Promise<CustomFieldInfo>;
  }

  /** Resolve the global/default context id for a custom field (options live here). */
  async customFieldDefaultContextId(fieldId: string): Promise<string> {
    const d = (await this.req(
      'GET',
      `/rest/api/3/field/${encodeURIComponent(fieldId)}/context`,
    )) as { values?: Array<{ id: string; isGlobalContext?: boolean }> };
    const values = d.values ?? [];
    const global = values.find(v => v.isGlobalContext === true);
    const first = values[0];
    const ctx = global ?? first;
    if (!ctx) throw new Error(`no context for custom field ${fieldId}`);
    return ctx.id;
  }

  /** Add select options to a field's context; returns created option ids. */
  async addFieldOptions(
    fieldId: string,
    contextId: string,
    values: string[],
  ): Promise<Array<{ id: string; value: string }>> {
    const d = (await this.req(
      'POST',
      `/rest/api/3/field/${encodeURIComponent(fieldId)}/context/${encodeURIComponent(contextId)}/option`,
      { options: values.map(value => ({ value })) },
    )) as { options?: Array<{ id: string; value: string }> };
    return d.options ?? [];
  }

  /** List the current options of a field's context. */
  async listFieldOptions(
    fieldId: string,
    contextId: string,
  ): Promise<Array<{ id: string; value: string }>> {
    const d = (await this.req(
      'GET',
      `/rest/api/3/field/${encodeURIComponent(fieldId)}/context/${encodeURIComponent(contextId)}/option`,
    )) as { values?: Array<{ id: string; value: string }> };
    return d.values ?? [];
  }

  /** Resolve the first screen id listed (fallback: default screen). */
  async defaultScreenId(): Promise<string> {
    const screens = (await this.req('GET', '/rest/api/3/screens?maxResults=1')) as {
      values?: Array<{ id: string }>;
    };
    const s = screens.values?.[0];
    if (!s) throw new Error('no screens available');
    return s.id;
  }

  /** Resolve the first tab id of a screen. */
  async screenFirstTabId(screenId: string): Promise<string> {
    const tabs = (await this.req(
      'GET',
      `/rest/api/3/screens/${encodeURIComponent(screenId)}/tabs`,
    )) as unknown as { [key: number]: { id: string } } | Array<{ id: string }>;
    const list = Array.isArray(tabs)
      ? tabs
      : Object.values(tabs).filter((t): t is { id: string } => !!t && typeof t.id === 'string');
    const tab = list[0];
    if (!tab) throw new Error(`no tabs on screen ${screenId}`);
    return tab.id;
  }

  /**
   * Add a field to a screen tab so it becomes settable via API for the issue
   * types using that screen. Idempotent-ish (adding an already-present field
   * is a no-op in Jira).
   */
  async addFieldToScreenTab(fieldId: string, screenId: string, tabId: string): Promise<void> {
    await this.req(
      'POST',
      `/rest/api/3/screens/${encodeURIComponent(screenId)}/tabs/${encodeURIComponent(tabId)}/fields`,
      { fieldId },
    );
  }

  /** Native workflow — list available transitions for an issue. */
  async getTransitions(key: string): Promise<Array<{ id: string; name: string; to?: { id?: string; name?: string } }>> {
    const d = (await this.req('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`)) as {
      transitions?: Array<{ id: string; name: string; to?: { id?: string; name?: string } }>;
    };
    return (d.transitions ?? []).map(t => {
      const to = t.to
        ? ({ ...(t.to.id !== undefined ? { id: String(t.to.id) } : {}), ...(t.to.name !== undefined ? { name: t.to.name } : {}) } as {
            id?: string;
            name?: string;
          })
        : undefined;
      return { id: String(t.id), name: t.name, ...(to !== undefined ? { to } : {}) };
    });
  }

  /** Native workflow — perform a transition by id. */
  async transitionIssue(key: string, transitionId: string): Promise<void> {
    await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      transition: { id: transitionId },
    });
  }

  /** List all screens (paginated). */
  async listScreens(): Promise<Array<{ id: string; name: string }>> {
    const out: Array<{ id: string; name: string }> = [];
    let startAt = 0;
    for (;;) {
      const d = (await this.req(
        'GET',
        `/rest/api/3/screens?startAt=${startAt}&maxResults=100`,
      )) as { values?: Array<{ id: string; name: string }>; isLast?: boolean };
      const batch = d.values ?? [];
      out.push(...batch);
      if (d.isLast || batch.length === 0) break;
      startAt += batch.length;
    }
    return out;
  }
}

/** Pusty domyślny config (nie wymaga env) — dla testów z fetchImpl. */
export function testConfig(site = 'https://test.atlassian.net'): JiraConfig {
  return { site, email: 'ai@example.com', token: 'tok' };
}