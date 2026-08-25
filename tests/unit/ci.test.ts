import { describe, expect, it, vi } from 'vitest';
import { buildCiWorkflow, verifyWorkflowRun, CiVerifyError } from '../../src/aialm/oss/github/ci.ts';
import type { GithubClient } from '../../src/aialm/oss/github/github.ts';

describe('buildCiWorkflow', () => {
  it('renders unit + e2e jobs with real commands', () => {
    const y = buildCiWorkflow({ repo: 'acme/widgets', unitCommands: ['npm ci', 'npm run typecheck', 'npm test'], hasE2e: true });
    expect(y).toContain('name: CI');
    expect(y).toContain('branches: [main]');
    expect(y).toContain('pull_request');
    expect(y).toContain('unit:');
    expect(y).toContain('- run: npm run typecheck');
    expect(y).toContain('- run: npm test');
    expect(y).toContain('e2e:');
    expect(y).toContain('npx playwright install --with-deps chromium');
  });

  it('omits the e2e job when the repo has no e2e', () => {
    const y = buildCiWorkflow({ repo: 'acme/widgets', unitCommands: ['npm ci'], hasE2e: false });
    expect(y).not.toContain('e2e:');
    expect(y).not.toContain('playwright');
  });
});

describe('verifyWorkflowRun', () => {
  function gh(runs: any[], jobs: any[] = []) {
    return {
      listActionsRuns: vi.fn(async () => runs),
      getActionsRunJobs: vi.fn(async () => jobs),
    } as unknown as GithubClient;
  }

  it('returns the run on success', async () => {
    const g = gh([{ id: 7, head_branch: 'main', conclusion: 'success', html_url: 'https://u/runs/7' }], [{ name: 'unit', conclusion: 'success' }, { name: 'e2e', conclusion: 'success' }]);
    const r = await verifyWorkflowRun(g, 'a', 'b', { branch: 'main' });
    expect(r.conclusion).toBe('success');
    expect(r.jobs.length).toBe(2);
  });

  it('throws with per-job detail on failure', async () => {
    const g = gh([{ id: 9, head_branch: 'main', conclusion: 'failure', html_url: 'https://u/runs/9' }], [{ name: 'unit', conclusion: 'success' }, { name: 'e2e', conclusion: 'failure' }]);
    await expect(verifyWorkflowRun(g, 'a', 'b', { branch: 'main' })).rejects.toThrow(CiVerifyError);
    await expect(verifyWorkflowRun(g, 'a', 'b', { branch: 'main' })).rejects.toThrow('e2e:failure');
  });
});
