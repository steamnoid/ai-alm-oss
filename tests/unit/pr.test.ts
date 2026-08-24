import { describe, expect, it } from 'vitest';
import {
  buildPrBody,
  buildPrTrace,
  DEFAULT_VIEWER_OFFER,
  prApproved,
  prGate,
  prWaveKey,
  validatePrBody,
} from '../../src/aialm/oss/pr/pr.ts';

const input = () => ({
  summary: 'Clear the password field on failed login.',
  externalRef: 'acme/widgets#12',
  evidenceRefs: ['verify:typecheck pass', 'verify:qa:e2e pass'],
  limitations: ['Restricted to login form.'],
  traceLink: 'https://ai-alm-oss.atlassian.net/browse/AIALMOSS',
});

describe('prGate', () => {
  it('blocks unless READY_FOR_PR and human approval present', () => {
    expect(prGate(false, true)).toMatchObject({ ok: false });
    expect(prGate(true, false)).toMatchObject({ ok: false });
    expect(prGate(true, true)).toMatchObject({ ok: true });
  });
});

describe('prApproved', () => {
  it('approves on a human APPROVE:<key> comment', () => {
    const key = 'a1b2c3d';
    expect(prApproved([{ id: 'h', bodyText: `APPROVE:${key}` }], key)).toBe(true);
    expect(prApproved([{ id: 'ai', bodyText: `[AI-generated] APPROVE:${key}` }], key)).toBe(false);
    expect(prApproved([{ id: 'h', bodyText: 'looks fine' }], key)).toBe(false);
  });
});

describe('prWaveKey', () => {
  it('is deterministic and order-insensitive', () => {
    expect(prWaveKey(['WIDG-9', 'WIDG-10'])).toBe(prWaveKey(['WIDG-10', 'WIDG-9']));
    expect(prWaveKey(['WIDG-9'])).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('buildPrBody', () => {
  it('contains all six mandated elements', () => {
    const body = buildPrBody(input());
    expect(body).toContain('### Summary');
    expect(body).toContain('Clear the password field on failed login.');
    expect(body).toContain('Fixes acme/widgets#12');
    expect(body).toContain('Tests / validation');
    expect(body).toContain('verify:typecheck pass');
    expect(body).toContain('Known limitations');
    expect(body).toContain('ai-alm-oss');
    expect(body).toContain('Execution trace');
    expect(body).toContain('https://ai-alm-oss.atlassian.net/browse/AIALMOSS');
    expect(body).toContain(DEFAULT_VIEWER_OFFER);
  });

  it('substitutes a Profile template and still guarantees the trace block', () => {
    const body = buildPrBody({ ...input(), template: '${summary}\n\n${issue}\n\n${tests}' });
    expect(body).toContain('Clear the password field on failed login.');
    expect(body).toContain('Fixes acme/widgets#12');
    expect(body).toContain('https://ai-alm-oss.atlassian.net/browse/AIALMOSS');
  });
});

describe('validatePrBody', () => {
  it('reports missing mandated elements', () => {
    const body = buildPrBody(input());
    expect(validatePrBody(body, { externalRef: 'acme/widgets#12', traceLink: 'https://ai-alm-oss.atlassian.net/browse/AIALMOSS' })).toEqual([]);
    const missing = validatePrBody('no trace at all', { externalRef: 'acme/widgets#12', traceLink: 'https://x' });
    expect(missing).toEqual(expect.arrayContaining(['tests / validation']));
  });
});

describe('buildPrTrace', () => {
  it('records prUrl ↔ commits ↔ work item ids', () => {
    const t = buildPrTrace({ prUrl: 'https://github.com/acme/widgets/pull/1', commits: ['a','b'], workItemIds: ['AIALMOSS-9'] });
    expect(t.prUrl).toBe('https://github.com/acme/widgets/pull/1');
    expect(t.commits).toEqual(['a', 'b']);
    expect(t.workItemIds).toEqual(['AIALMOSS-9']);
  });
});
