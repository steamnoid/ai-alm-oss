/**
 * aialm-oss-shared — canonical content markers for AC, GENERATED QA/DEV specs.
 */
import { isAiMarked } from './identity.js';

/** Markery sekcji w opisie czegoś targeta (child/subticket). */
export const Sections = {
  productAc: '## Product AC',
  decomposed: '## Decomposed',
  generatedQa: '## GENERATED QA',
  generatedDev: '## GENERATED DEV',
  arch: '## Architecture Review',
  sec: '## Security Review',
  implementation: '## Implementation Contract',
} as const;

/** Marker w komentarzu niosący propozycję (umowa aialm-shared). */
export function proposalMarker(skill: string): string {
  return skill;
}

export interface ParsedProposal {
  issueKey: string;
  skill: string;
  id: string;
}

/**
 * Parsuje `[AI-generated] Proposal — ISSUE-KEY — skill:id`. Zwraca null
 * jeśli to nie jest nagłówek propozycji AI.
 */
export function parseProposalHeader(text: string): ParsedProposal | null {
  if (!isAiMarked(text)) return null;
  const m = text.match(/proposal\s*—\s*([A-Za-z0-9-]+)\s*—\s*([a-z][a-z0-9-]*):([0-9a-f]{7})/i);
  if (!m) return null;
  return { issueKey: m[1]!, skill: m[2]!, id: m[3]! };
}