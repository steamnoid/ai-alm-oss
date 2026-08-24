import { createHash } from 'node:crypto';

/**
 * Deterministic normalization for stable payloads (aialm-shared contract).
 * Whitespace-insensitive, case-insensitive, entity-safe.
 */
export function normalize(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * proposalId = hash(normalize(stablePayload)).toString(16).slice(0,7).padStart(7,'0')
 * Same algorithm as the V4 aialm-shared contract.
 */
export function proposalIdFor(stablePayload: string): string {
  const h = createHash('sha256').update(normalize(stablePayload), 'utf8').digest('hex');
  return h.slice(0, 7).padStart(7, '0');
}

/** Header form: [AI-generated] Proposal — AIALMOSS-N — aialm-oss-<skill>:<id> */
export function proposalHeader(issueKey: string, skill: string, id: string): string {
  return `[AI-generated] Proposal — ${issueKey} — ${skill}:${id}`;
}

export const AI_MARK = '[AI-generated]';
