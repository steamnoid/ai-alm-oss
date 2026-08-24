import { describe, expect, it } from 'vitest';
import { MARKERS, extractFooterId, skillMarker } from '../../src/aialm/oss/shared/markers.ts';
import { renderStatusSummary } from '../../src/aialm/oss/shared/status.ts';

describe('markers', () => {
  it('extracts footer ids from bodies', () => {
    expect(extractFooterId('why it matters\nproposal:0ab12cd')).toBe('0ab12cd');
    expect(extractFooterId('no footer here')).toBeNull();
    expect(extractFooterId('proposal:zzz')).toBeNull();
  });

  it('builds skill markers with aialm-oss prefix only', () => {
    expect(skillMarker('aialm-oss-po-analyze', '0ab12cd')).toBe('aialm-oss-po-analyze:0ab12cd');
  });

  it('keeps canonical markers stable (contract)', () => {
    expect(MARKERS.QA_PROPOSAL_HEADING).toBe('QA Scenario Proposal');
    expect(MARKERS.DEV_PROPOSAL_HEADING).toBe('Implementation Contract Proposal');
    expect(MARKERS.AC_SECTION).toBe('## Acceptance Criteria');
    expect(MARKERS.GENERATED_QA_HASH).toBe('GENERATED QA hash:');
    expect(MARKERS.END_GENERATED_QA).toBe('END GENERATED QA');
  });
});

describe('renderStatusSummary', () => {
  it('renders shared taxonomy rows', () => {
    const out = renderStatusSummary('Import Report', [
      { target: 'owner/repo#12', status: 'CREATED' },
      { target: 'owner/repo#13', status: 'SKIPPED', detail: 'already imported' },
    ]);
    expect(out).toContain('- CREATED owner/repo#12');
    expect(out).toContain('- SKIPPED owner/repo#13 — already imported');
  });
});
