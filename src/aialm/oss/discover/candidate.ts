/**
 * aialm-oss-discover — CandidateIssue model + pure helpers.
 */

/**
 * Recommendation = suitability LABEL of a candidate (SKILL.md rule), NOT a
 * ticket STAGE. AGENTS.md zakazuje `BLOCKED` jako stanu (STAGE) — tutaj
 * `BLOCKED` opisuje kandydata (wymaga creds/private infra), nigdy nie jest
 * zapisywany jako krotka stanu (taki kandydat nie staje się taskiem).
 */
export type CandidateRecommendation =
  | 'READY'
  | 'NEEDS-CLARIFICATION'
  | 'BLOCKED'
  | 'UNSUITABLE';

/** Deterministic qualification odcinkowo z profilu; recommendation jest kluczowa. */
export interface CandidateIssue {
  issueType: string;
  scope: string;
  ambiguity: string;
  codeLocalizability: string;
  testability: string;
  dependencyRisk: string;
  expectedComplexity: string;
  conventionFit: string;
  implementationConfidence: string;
  recommendation: CandidateRecommendation;
  rationale: string;
}

/** Stable wskazanie zewnętrzne: `owner/repo#123`. */
export function externalRef(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/** Marker idempotency wbudowany w każdy kandydat issue. */
export function externalMarker(ref: string): string {
  return `aialm-external: ${ref}`;
}

/** Wyciągnij ref z opisu (plain text lub JSON-stringified ADF). */
export function extractExternalRef(text: string): string | null {
  const m = /aialm-external:\s*([\w.-]+\/[\w.-]+#\d+)\b/.exec(text);
  return m ? m[1]! : null;
}

export function summaryForCandidate(repo: string, number: number, title: string): string {
  return `[candidate] ${externalRef(repo, number)} — ${title}`;
}