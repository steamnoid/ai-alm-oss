/**
 * aialm-oss-shared — identity: stable payload normalization, proposal id, AI mark.
 */
import { createHash } from 'node:crypto';

/**
 * Deterministyczna normalizacja stabilnych payloadów (umowa aialm-shared).
 * Whitespace/case-insensitive, entity-safe, aby speak back="A" i " a "
 * mapowały do tej samej propozycji.
 */
export function normalize(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * proposalId = hash(normalize(stablePayload)).toString(16).slice(0,7).padStart(7,'0').
 */
export function proposalIdFor(stablePayload: string): string {
  const h = createHash('sha256').update(normalize(stablePayload), 'utf8').digest('hex');
  return h.slice(0, 7).padStart(7, '0');
}

/** Header: [AI-generated] Proposal — AAO-N — aialm-oss-<skill>:<id>. */
export function proposalHeader(issueKey: string, skill: string, id: string): string {
  return `[AI-generated] Proposal — ${issueKey} — ${skill}:${id}`;
}

export const AI_MARK = '[AI-generated]';

/**
 * Tolerancyjne wykrywanie markera AI. Agenci czasem emitują marker bez
 * nawiasów ("AI-generated Proposal — …"); takie teksty muszą być klasyfikowane
 * jako AI, inaczej propozycja zostanie potraktowana jak ludzka i kanał
 * akceptacji się zepsuje.
 */
export function isAiMarked(text: string | undefined | null): boolean {
  const t = (text ?? '').toLowerCase();
  return t.includes('[ai-generated]') || t.includes('ai-generated');
}