import { describe, expect, it, vi } from 'vitest';
import { provisionRepoBoard } from '../../src/aialm/oss/board/provision.ts';
import type { JiraClient } from '../../src/aialm/oss/alm/jira.ts';
import { PROVISION_STATUSES } from '../../src/aialm/oss/alm/board.ts';

const input = { owner: 'acme', repo: 'widgets', leadAccountId: 'L1' };

function mockJira(existingName: string | null) {
  // existingName null => project does not exist; else reuse/mismatch logic.
  const jira = {
    projectExists: vi.fn(async (key: string) => existingName !== null),
    getProject: vi.fn(async () => ({ name: existingName ?? '' })),
    myself: vi.fn(async () => ({ accountId: 'L1' })),
    createKanbanProject: vi.fn(async (i: { key: string; name: string }) => ({ id: '1', key: i.key })),
    createProjectStatuses: vi.fn(async (project: string, statuses: { name: string }[]) => ({
      created: statuses.length,
      skipped: 0,
      existing: [],
    })),
  } as unknown as JiraClient & Record<string, any>;
  return { jira };
}

describe('provisionRepoBoard', () => {
  it('creates a project with the repo-derived name and provisions all statuses', async () => {
    const { jira } = mockJira(null);
    const r = await provisionRepoBoard(jira, input);
    expect(r.projectKey).toBe('WIDGETS');
    expect(r.name).toBe('[AI-ALM] acme/widgets');
    expect(r.created).toBe(true);
    expect(r.statuses.created).toBe(PROVISION_STATUSES.length);
    expect(jira.createKanbanProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: '[AI-ALM] acme/widgets', key: 'WIDGETS' }),
    );
  });

  it('reuses an existing project matching the repo-derived name (idempotent)', async () => {
    const { jira } = mockJira('[AI-ALM] acme/widgets');
    const r = await provisionRepoBoard(jira, input);
    expect(r.projectKey).toBe('WIDGETS');
    expect(r.created).toBe(false);
    expect(jira.createKanbanProject).not.toHaveBeenCalled();
  });
});
