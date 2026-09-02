/**
 * aialm-oss-onboard — provision of the repo's private Jira tracking project.
 *
 * Idempotentny: projekt o dokładnej nazwie `[AI-ALM] owner/repo` jest reużywany;
 * w przeciwnym razie tworzony jest pierwszy wolny klucz z BASE, BASE2..BASE9.
 */
import { JiraClient, JiraError } from '../adapter/jira.js';
import { deriveProjectKey, projectKeyCandidates, projectDisplayName } from './key.js';

export interface ProvisionResult {
  projectKey: string;
  created: boolean;
}

export async function provisionRepoProject(
  jira: JiraClient,
  input: { owner: string; repo: string; leadAccountId: string },
): Promise<ProvisionResult> {
  const wantedName = projectDisplayName(input.owner, input.repo);

  for (const key of projectKeyCandidates(input.repo)) {
    if (await jira.projectExists(key)) {
      const existing = await jira.getProject(key);
      if (existing.name === wantedName) return { projectKey: key, created: false };
      continue; // kolizja z niepowiązanym projektem
    }
    try {
      await jira.createProject({
        key,
        name: wantedName,
        leadAccountId: input.leadAccountId,
        description: `Governed execution trace for ${input.owner}/${input.repo}. Created by ai-alm-oss.`,
      });
      return { projectKey: key, created: true };
    } catch (e) {
      // Kolizja (zarchiwizowany / out-of-band projekt na tym kluczu). Takiego
      // projektu nie da się zarchiwizować ponownie przez getProject (404 dla
      // archived) — pomijamy ten klucz i przechodzimy do następnego kandydata.
      // Reuse działającego projektu obsługiwany jest już wyżej przez projectExists.
      if (e instanceof JiraError && e.status === 400 && /already exists|uses this project key/i.test(e.detail)) {
        continue;
      }
      throw e;
    }
  }
  throw new Error(`No free project key for repo "${input.owner}/${input.repo}" (derived "${deriveProjectKey(input.repo)}")`);
}