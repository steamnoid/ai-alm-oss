import { describe, expect, it } from 'vitest';
import {
  classifyImpl,
  implSummary,
  implTargetInputs,
  planImpl,
} from '../../src/aialm/oss/dev/impl.ts';
import { adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

const AC = 'Scenario: Clear password\nGiven a failed login\nThen the field is empty';

function fullDesc() {
  return doc(
    para('Manual note'),
    para({ t: '## Acceptance Criteria', b: true }),
    codeBlock(AC),
    para({ t: 'GENERATED QA hash: abc1234', c: true }),
    codeBlock('Scenario: Clear password field\nGiven a failed login\nThen the field is empty'),
    para({ t: 'END GENERATED QA', c: true }),
    para({ t: '## Implementation Contract', b: true }),
    para({ t: 'GENERATED DEV hash: def5678', c: true }),
    para({ t: '# kind: LOCATOR', c: true }),
    para({ t: '# source: x', c: true }),
    para({ t: 'title: Expose submit test id', b: true }),
    para('Add data-testid="login-submit" to the submit button.'),
    para({ t: 'END GENERATED DEV', c: true }),
  );
}

describe('implTargetInputs', () => {
  it('reads AC, GENERATED QA and contract hooks from a description', () => {
    const i = implTargetInputs(fullDesc());
    expect(i.hasAc).toBe(true);
    expect(i.hasGeneratedQa).toBe(true);
    expect(i.contract.hasContract).toBe(true);
    expect(i.contract.hooks).toEqual(['login-submit']);
    expect(i.contract.kinds).toContain('LOCATOR');
  });

  it('reports missing inputs', () => {
    const i = implTargetInputs(doc(para('nothing')));
    expect(i.hasAc).toBe(false);
    expect(i.hasGeneratedQa).toBe(false);
    expect(i.contract.hasContract).toBe(false);
  });
});

describe('planImpl', () => {
  it('BLOCKS without approved Product AC', () => {
    const r = planImpl({ acs: [], hasAc: false, hasGeneratedQa: true, contract: { hasContract: true, hooks: ['x'], kinds: ['LOCATOR'] } });
    expect(r.status).toBe('BLOCKED');
    expect(r.blockedReasons[0]).toContain('Product AC');
  });

  it('BLOCKS without GENERATED QA (intent alignment)', () => {
    const r = planImpl({ acs: [AC], hasAc: true, hasGeneratedQa: false, contract: { hasContract: true, hooks: ['x'], kinds: ['LOCATOR'] } });
    expect(r.status).toBe('BLOCKED');
    expect(r.blockedReasons[0]).toContain('GENERATED QA');
  });

  it('BLOCKS when the contract is missing (run dev-analyst first)', () => {
    const r = planImpl({ acs: [AC], hasAc: true, hasGeneratedQa: true, contract: { hasContract: false, hooks: [], kinds: [] } });
    expect(r.status).toBe('BLOCKED');
    expect(r.blockedReasons[0]).toContain('Implementation Contract');
  });

  it('BLOCKS when UI is in scope but no approved hooks', () => {
    const r = planImpl({ acs: [AC], hasAc: true, hasGeneratedQa: true, contract: { hasContract: true, hooks: [], kinds: ['LOCATOR'] } });
    expect(r.status).toBe('BLOCKED');
    expect(r.blockedReasons[0]).toContain('no approved hooks');
  });

  it('plans one HOOK slice per hook and one AC slice per AC', () => {
    const r = planImpl({
      acs: [AC, 'Scenario: Highlight field\nGiven a failed login\nThen it is underlined'],
      hasAc: true,
      hasGeneratedQa: true,
      contract: { hasContract: true, hooks: ['login-submit'], kinds: ['LOCATOR'] },
    });
    expect(r.status).toBe('IMPLEMENTED');
    const hookSlices = r.slices.filter(s => s.kind === 'HOOK');
    const acSlices = r.slices.filter(s => s.kind === 'AC');
    expect(hookSlices).toHaveLength(1);
    expect(hookSlices[0]!.hook).toBe('login-submit');
    expect(acSlices).toHaveLength(2);
    expect(r.blockedReasons).toHaveLength(0);
  });
});

describe('classifyImpl', () => {
  it('classifies honestly', () => {
    expect(classifyImpl([] as never)).toBe('BLOCKED');
    expect(classifyImpl([{ status: 'PLANNED' as const }] as never)).toBe('IMPLEMENTED');
    expect(classifyImpl([{ status: 'PLANNED' as const }, { status: 'BLOCKED' as const }] as never)).toBe('IMPLEMENTED_WITH_FAILURES');
    expect(classifyImpl([{ status: 'BLOCKED' as const }] as never)).toBe('BLOCKED');
  });
});

describe('implSummary', () => {
  it('reports status and counts', () => {
    const t = adfToPlainText(implSummary('IMPLEMENTED', { hooks: 1, acs: 2 }));
    expect(t).toContain('Feature implementation summary');
    expect(t).toContain('status: IMPLEMENTED');
    expect(t).toContain('Hooks: 1');
    expect(t).toContain('AC: 2');
  });
});
