import { describe, expect, it, vi } from 'vitest';
import { deriveProjectKey, provisionRepoProject } from '../../src/aialm/oss/onboard/provision.ts';
import type { JiraClient } from '../../src/aialm/oss/alm/jira.ts';

describe('deriveProjectKey', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(deriveProjectKey('react')).toBe('REACT');
    expect(deriveProjectKey('my.cool_repo')).toBe('MYCOOLREPO');
  });

  it('truncates to 10 chars', () => {
    expect(deriveProjectKey('verylongreponame')).toBe('VERYLONGRE');
  });

  it('rejects empty derivation', () => {
    expect(() => deriveProjectKey('---')).toThrow(/Cannot derive/);
  });
});

function mockJira(existing: Record<string, string>) {
  // existing: key -> project name
  const created: { key: string; name: string }[] = [];
  const jira = {
    projectExists: vi.fn(async (key: string) => key in existing || created.some(c => c.key === key)),
    getProject: vi.fn(async (key: string) => ({
      name: existing[key] ?? created.find(c => c.key === key)?.name ?? '',
    })),
    createKanbanProject: vi.fn(async (input: { key: string; name: string }) => {
      created.push({ key: input.key, name: input.name });
      return { id: '1', key: input.key };
    }),
  } as unknown as JiraClient & { createKanbanProject: any };
  return { jira, created };
}

const input = { owner: 'acme', repo: 'widgets', leadAccountId: 'L1' };

describe('provisionRepoProject', () => {
  it('creates a new project on first run', async () => {
    const { jira, created } = mockJira({});
    const r = await provisionRepoProject(jira, input);
    expect(r).toEqual({ projectKey: 'WIDGETS', created: true });
    expect(created[0]!.name).toBe('[AI-ALM] acme/widgets');
  });

  it('reuses the same project on second run (idempotent)', async () => {
    const { jira, created } = mockJira({});
    await provisionRepoProject(jira, input);
    const r2 = await provisionRepoProject(jira, input);
    expect(r2).toEqual({ projectKey: 'WIDGETS', created: false });
    expect(created.length).toBe(1);
  });

  it('skips unrelated key collisions and takes next free suffix', async () => {
    const { jira, created } = mockJira({ WIDGETS: 'Some other project' });
    const r = await provisionRepoProject(jira, input);
    expect(r.projectKey).toBe('WIDGETS2');
    expect(r.created).toBe(true);
    expect(created[0]!.key).toBe('WIDGETS2');
  });
});
