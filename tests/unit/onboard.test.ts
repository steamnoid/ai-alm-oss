import { describe, expect, it, vi } from 'vitest';
import { runOnboard } from '../../src/aialm/oss/onboard/onboard.ts';
import type { JiraClient } from '../../src/aialm/oss/alm/jira.ts';
import type { GithubClient } from '../../src/aialm/oss/github/github.ts';

function mockDeps(opts: { existingGovernance?: boolean } = {}) {
  const govCreated: any[] = [];
  const createdIssues: any[] = [];
  let n = 100;
  const jira = {
    myself: vi.fn(async () => ({ accountId: 'LEAD1', emailAddress: 'x@y.z' })),
    projectExists: vi.fn(async () => opts.existingGovernance),
    getProject: vi.fn(async () => ({ name: '[AI-ALM] acme/widgets', lead: { accountId: 'LEAD1' } })),
    createKanbanProject: vi.fn(async (i: { key: string; name: string }) => ({ id: '1', key: i.key })),
    searchJql: vi.fn(async (jql: string) => (/labels = governance/.test(jql) && opts.existingGovernance ? [{ key: 'WIDG-9' }] : [])),
    createIssue: vi.fn(async (fields: Record<string, unknown>) => {
      const labels = fields.labels as string[] | undefined;
      if (labels?.includes('governance')) govCreated.push(fields);
      createdIssues.push(fields);
      return { key: `WIDG-${++n}` };
    }),
  } as unknown as JiraClient;
  const gh = {
    getRepo: vi.fn(async () => ({ full_name: 'acme/widgets', default_branch: 'main', fork: false, html_url: 'https://github.com/acme/widgets', language: 'TypeScript' })),
    getFile: vi.fn(async () => null),
    listDir: vi.fn(async () => { throw new Error('404'); }),
  } as unknown as GithubClient;
  return { jira, gh, govCreated, createdIssues };
}

describe('runOnboard', () => {
  it('provisions the project, ensures the governance ticket and seeds the Profile issue', async () => {
    const { jira, gh, govCreated, createdIssues } = mockDeps();
    const r = await runOnboard(jira, gh, { owner: 'acme', repo: 'widgets' });
    expect(r.projectKey).toBe('WIDGETS');
    expect(r.created).toBe(true);
    expect(r.governanceKey).toBe('WIDG-101');
    expect(r.profileIssueKey).toBe('WIDG-102');
    // governance ticket created once with label governance + role defaults
    expect(govCreated).toHaveLength(1);
    expect(govCreated[0]!.labels).toEqual(['governance']);
    // profile issue created with label profile
    const profileIssue = createdIssues.find(i => (i.labels as string[])?.includes('profile'));
    expect(profileIssue?.summary).toBe('Project AI Profile');
  });

  it('reuses an existing governance ticket (idempotent) and does not duplicate', async () => {
    const { jira, gh, govCreated } = mockDeps({ existingGovernance: true });
    const r = await runOnboard(jira, gh, { owner: 'acme', repo: 'widgets' });
    expect(r.governanceKey).toBe('WIDG-9');
    expect(govCreated).toHaveLength(0);
  });
});
