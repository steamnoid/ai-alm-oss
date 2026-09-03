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

  const failures: Array<{ key: string; error: string }> = [];
  for (const key of projectKeyCandidates(input.repo)) {
    if (await jira.projectExists(key)) {
      const existing = await jira.getProject(key);
      if (existing.name === wantedName) return { projectKey: key, created: false };
      failures.push({ key, error: `projectExists=true but name mismatch (existing="${existing.name}" wanted="${wantedName}")` });
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
        failures.push({ key, error: `Jira ${e.status} ${e.path}: ${e.detail}` });
        continue;
      }
      // Nieoczekiwany błąd — od razu surfuj z kontekstem klucza
      if (e instanceof JiraError) {
        throw new Error(`createProject ${key} failed: Jira ${e.status} ${e.path}: ${e.detail}`);
      }
      throw e;
    }
  }
  const details = failures.map(f => `  ${f.key}: ${f.error}`).join('\n');
  throw new Error(
    `No free project key for repo "${input.owner}/${input.repo}" (derived "${deriveProjectKey(input.repo)}")\n` +
      `tried ${failures.length} candidate(s):\n${details || '  (no candidates tried)'}`,
  );
}