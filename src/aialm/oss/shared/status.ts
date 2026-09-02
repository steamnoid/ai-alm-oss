/**
 * aialm-oss-shared — raport taxonomies (AGENTS.md).
 *
 * UWAGA: brak `BLOCKED` wg AGENTS.md — brak requisitu wyrażamy BRAKIEM AKCJI,
 * nigdy abstrakcyjnym "zablokowane". Dla świata zewnętrznego używamy tylko
 * poniższej taksonomii.
 */
export const REPORT_STATUSES = [
  'APPLIED',
  'SKIPPED',
  'FAILED',
  'NOT_ATTEMPTED',
  'CREATED',
  'IMPLEMENTED',
  'IMPLEMENTED_WITH_FAILURES',
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface StatusRow {
  target: string;
  status: ReportStatus;
  detail?: string;
}

/** Renderuj wspólny blok podsumowania (każdy mutator/summary). */
export function renderStatusSummary(title: string, rows: readonly StatusRow[]): string {
  const lines = rows.map(r => `- ${r.status} ${r.target}${r.detail ? ` — ${r.detail}` : ''}`);
  return [title, ...lines].join('\n');
}