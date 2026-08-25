import { describe, expect, it } from 'vitest';
import { REPORT_STATUSES, renderStatusSummary, type StatusRow } from '../../src/aialm/oss/shared/status.ts';

describe('status taxonomy', () => {
  it('lists the shared REPORT_STATUSES taxonomy', () => {
    expect(REPORT_STATUSES).toEqual(['APPLIED', 'SKIPPED', 'BLOCKED', 'FAILED', 'NOT_ATTEMPTED', 'CREATED', 'IMPLEMENTED', 'IMPLEMENTED_WITH_FAILURES']);
  });

  it('renders a stable summary block', () => {
    const rows: StatusRow[] = [{ target: 'acme/widgets#1', status: 'CREATED', detail: 'WELLBEINGT-2' }, { target: 'web-app', status: 'SKIPPED' }];
    const t = renderStatusSummary('Import Report', rows);
    expect(t).toBe('Import Report\n- CREATED acme/widgets#1 — WELLBEINGT-2\n- SKIPPED web-app');
  });
});
