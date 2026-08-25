import type { GithubClient } from './github.ts';

export interface CiWorkflowInput {
  repo: string;
  nodeVersion?: string;
  unitCommands: string[]; // e.g. ['npm ci', 'npm run typecheck', 'npm test']
  hasE2e: boolean;
}

/**
 * Build a GitHub Actions workflow (`.github/workflows/ci.yml`) from the repo's
 * real validation commands. Unit (typecheck + unit tests) and e2e are separate
 * jobs so a failing e2e never blocks unit signal. Never invents commands.
 */
export function buildCiWorkflow(input: CiWorkflowInput): string {
  const node = input.nodeVersion ?? '20';
  const unitSteps = [
    ...input.unitCommands.map(c => `      - run: ${c}`),
  ];
  const unit = `  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${node}
          cache: npm
${unitSteps.join('\n')}`;

  const e2e = input.hasE2e
    ? `
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${node}
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test`
    : '';

  return `name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
${unit}${e2e}
`;
}

export interface CiRun {
  runId: number;
  conclusion: string;
  url: string;
  jobs: { name: string; conclusion: string }[];
}

export class CiVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CiVerifyError';
  }
}

/**
 * Poll GitHub Actions for the workflow run triggered by the CI-ensure commit.
 * Returns once the run concludes; throws on failure with per-job detail.
 * `timeoutMs` bounds the wait (e.g. 10m) — beyond it → CiVerifyError.
 */
export async function verifyWorkflowRun(
  gh: GithubClient,
  owner: string,
  repo: string,
  opts: { branch: string; timeoutMs?: number; pollMs?: number },
): Promise<CiRun> {
  const { branch, timeoutMs = 600_000, pollMs = 10_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await gh.listActionsRuns(owner, repo, branch);
    const latest = runs.find(r => r.head_branch === branch && r.conclusion);
    if (latest) {
      const jobs = await gh.getActionsRunJobs(owner, repo, latest.id);
      const jobSummary = jobs.map((j: any) => ({ name: j.name, conclusion: j.conclusion ?? 'unknown' }));
      const run: CiRun = {
        runId: latest.id,
        conclusion: latest.conclusion,
        url: latest.html_url,
        jobs: jobSummary,
      };
      if (run.conclusion !== 'success') {
        const bad = jobSummary.filter(j => j.conclusion !== 'success').map(j => `${j.name}:${j.conclusion}`).join(', ');
        throw new CiVerifyError(`CI run ${run.runId} ${run.conclusion} (${bad}) — see ${run.url}`);
      }
      return run;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new CiVerifyError(`CI run did not complete within ${timeoutMs}ms`);
}
