export const REPORT_STATUSES = [
  'APPLIED',
  'SKIPPED',
  'BLOCKED',
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

/** Render a shared-taxonomy summary block (used by every mutator/summary comment). */
export function renderStatusSummary(title: string, rows: StatusRow[]): string {
  const lines = rows.map(r => `- ${r.status} ${r.target}${r.detail ? ` — ${r.detail}` : ''}`);
  return [title, ...lines].join('\n');
}
