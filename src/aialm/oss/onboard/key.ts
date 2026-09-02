/**
 * aialm-oss-onboard — Jira project key derivation (pure).
 */

/** "my.cool_repo" → "MYCOOLREPO" (uppercase alnum, max 10 chars). */
export function deriveProjectKey(repoName: string): string {
  const clean = repoName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!clean) throw new Error(`Cannot derive project key from repo name: "${repoName}"`);
  return clean.slice(0, 10);
}

/** Candidate keys in collision order: BASE, BASE2..BASE9. */
export function projectKeyCandidates(repoName: string): string[] {
  const base = deriveProjectKey(repoName);
  const head = base.slice(0, 8);
  const candidates = [base];
  let n = 2;
  while (candidates.length < 10) {
    candidates.push(`${head}${n}`);
    n += 1;
  }
  return candidates;
}

/** Name of the repo's private tracking project. */
export function projectDisplayName(owner: string, repo: string): string {
  return `[AI-ALM] ${owner}/${repo}`;
}