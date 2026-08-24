import type { JiraClient } from '../alm/jira.ts';

/**
 * Derive a Jira project key from a repo name: uppercase alphanumerics only,
 * max 10 chars (Jira limit). "my.cool_repo" -> "MYCOOLREPO".
 */
export function deriveProjectKey(repoName: string): string {
  const clean = repoName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!clean) throw new Error(`Cannot derive project key from repo name: "${repoName}"`);
  return clean.slice(0, 10);
}

export interface ProvisionResult {
  projectKey: string;
  created: boolean;
}

/**
 * Step zero of onboarding: ensure a private tracking home exists for the repo.
 *
 * Idempotency: a project named exactly `[AI-ALM] owner/repo` is reused;
 * otherwise the first free derived key (NAME, NAME2..NAME9) is created.
 */
export async function provisionRepoProject(
  jira: JiraClient,
  input: { owner: string; repo: string; leadAccountId: string },
): Promise<ProvisionResult> {
  const wantedName = `[AI-ALM] ${input.owner}/${input.repo}`;
  const base = deriveProjectKey(input.repo);

  const candidates = [base];
  while (candidates.length < 10) {
    candidates.push(`${base.slice(0, 8)}${candidates.length + 1}`);
  }

  for (const key of candidates) {
    if (await jira.projectExists(key)) {
      const existing = await jira.getProject(key);
      if (existing.name === wantedName) return { projectKey: key, created: false };
      continue; // collision with an unrelated project
    }
    await jira.createKanbanProject({
      key,
      name: wantedName,
      description: `Governed execution trace for ${input.owner}/${input.repo}. Created by ai-alm-oss.`,
      leadAccountId: input.leadAccountId,
    });
    return { projectKey: key, created: true };
  }
  throw new Error(`No free project key for "${wantedName}" (tried ${candidates.join(', ')})`);
}
