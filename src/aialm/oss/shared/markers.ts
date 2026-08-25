/** Canonical AI_MARKERS (aialm-oss-shared §9) — must match code and skill docs. */

export const MARKERS = {
  AC_SECTION: '## Acceptance Criteria',
  IMPLEMENTATION_CONTRACT: '## Implementation Contract',
  PROPOSAL: '[AI-generated] Proposal',
  BLOCKED: '[AI-generated] Blocked',
  UPDATE_APPROVED_AC: '[AI-generated] Update Approved AC',
  UPDATE_APPROVED_QA: '[AI-generated] Update Approved QA',
  UPDATE_APPROVED_DEV: '[AI-generated] Update Approved Implementation Contract',
  WORK_ITEMIZATION: '[AI-generated] Work Itemization',
  CANDIDATE_QUALIFICATION: 'Candidate Qualification',
  IMPORT_REPORT: 'Import Report',
  QA_PROPOSAL_HEADING: 'QA Scenario Proposal',
  DEV_PROPOSAL_HEADING: 'Implementation Contract Proposal',
  GENERATED_QA_HASH: 'GENERATED QA hash:',
  END_GENERATED_QA: 'END GENERATED QA',
  GENERATED_DEV_HASH: 'GENERATED DEV hash:',
  END_GENERATED_DEV: 'END GENERATED DEV',
} as const;

/** Skill markers used in proposal envelopes: aialm-oss-<skill>:<id> */
export type OssSkill =
  | 'aialm-oss-po-analyze'
  | 'aialm-oss-qa-analyze'
  | 'aialm-oss-dev-analyst'
  | 'aialm-oss-po-prep-decompose';

export function skillMarker(skill: OssSkill, id: string): string {
  return `${skill}:${id}`;
}

export function proposalFooter(id: string): string {
  return `proposal:${id}`;
}

/** Extract proposal:<id> footer id from a text body, if present. */
export function extractFooterId(body: string): string | null {
  const m = /proposal:\s*([0-9a-f]{7})/.exec(body);
  return m ? (m[1] as string) : null;
}
