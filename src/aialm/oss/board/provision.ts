import type { JiraClient } from '../alm/jira.ts';
import { PROVISION_STATUSES } from '../alm/board.ts';
import { provisionRepoProject } from '../onboard/provision.ts';

/**
 * REST-only board provisioning core (no browser, no session, no 2FA).
 * Shared by scripts/board-create.mts and scripts/run-pipeline.mts.
 */

export interface ProvisionResult {
  projectKey: string;
  name: string;
  created: boolean;
  statuses: { created: number; skipped: number; existing: string[] };
}

/**
 * Ensure the team-managed project exists (with the repo-derived name
 * `[AI-ALM] owner/repo`) and the 15 role statuses are provisioned
 * scope=PROJECT. Idempotent: existing statuses are skipped; an existing
 * project is reused only when its name matches the repo-derived name.
 */
export async function provisionRepoBoard(
  jira: JiraClient,
  input: { owner: string; repo: string; leadAccountId: string },
): Promise<ProvisionResult> {
  const p = await provisionRepoProject(jira, input);
  const statuses = await jira.createProjectStatuses(p.projectKey, [...PROVISION_STATUSES]);
  return {
    projectKey: p.projectKey,
    name: `[AI-ALM] ${input.owner}/${input.repo}`,
    created: p.created,
    statuses,
  };
}
