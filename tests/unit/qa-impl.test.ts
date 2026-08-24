import { describe, expect, it } from 'vitest';
import {
  classifyPlan,
  extractContract,
  extractGeneratedQa,
  planSummary,
  planTests,
  testPathFor,
  titleFromScenario,
} from '../../src/aialm/oss/qa/impl.ts';
import { adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

const S1 = 'Scenario: Clear password field\nGiven a failed login\nThen the field is empty';
const S2 = 'Scenario: Highlight failing field\nGiven a failed login\nThen it is underlined';

function descWithAll() {
  return doc(
    para('Manual note'),
    para({ t: '## Acceptance Criteria', b: true }),
    codeBlock('Scenario: Clear password\nGiven a failed login\nThen the field is empty'),
    para({ t: 'GENERATED QA hash: abc1234', c: true }),
    para({ t: '# source: x', c: true }),
    para({ t: '# kind: CORE', c: true }),
    codeBlock(S1),
    codeBlock(S2),
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

describe('titleFromScenario / testPathFor', () => {
  it('extracts the scenario title and a stable path', () => {
    expect(titleFromScenario(S1)).toBe('Clear password field');
    expect(titleFromScenario('no scenario header')).toBe('no scenario header');
    expect(testPathFor('Clear password field')).toBe('tests/qa/clear-password-field.test.ts');
  });
});

describe('extractGeneratedQa', () => {
  it('extracts scenarios from the GENERATED QA block', () => {
    expect(extractGeneratedQa(descWithAll())).toEqual([S1, S2]);
    expect(extractGeneratedQa(doc(para('no block')))).toEqual([]);
  });
});

describe('extractContract', () => {
  it('extracts hooks (data-testid) and kinds from the GENERATED DEV block', () => {
    const c = extractContract(descWithAll());
    expect(c.hasContract).toBe(true);
    expect(c.hooks).toEqual(['login-submit']);
    expect(c.kinds).toContain('LOCATOR');
    expect(extractContract(doc(para('no contract'))).hasContract).toBe(false);
  });
});

describe('planTests', () => {
  it('BLOCKS the target when there is no GENERATED QA', () => {
    const r = planTests({ generatedQa: [], contract: { hasContract: true, hooks: [], kinds: [] } });
    expect(r.status).toBe('BLOCKED');
    expect(r.tests).toHaveLength(0);
  });

  it('BLOCKS each scenario when UI automation is required but no approved hooks', () => {
    const contract = extractContract(doc(
      para({ t: 'GENERATED DEV hash: x', c: true }),
      para({ t: '# kind: LOCATOR', c: true }),
      para({ t: 'END GENERATED DEV', c: true }),
    ));
    expect(contract.hasContract).toBe(true);
    expect(contract.hooks).toEqual([]); // kind LOCATOR but no data-testid
    const r = planTests({ generatedQa: [S1], contract });
    expect(r.status).toBe('BLOCKED');
    expect(r.tests[0]!.status).toBe('BLOCKED');
    expect(r.tests[0]!.reason).toContain('no approved hook');
  });

  it('binds exactly the contract hook and produces traceable QA titles', () => {
    const r = planTests({ generatedQa: [S1, S2], contract: { hasContract: true, hooks: ['login-submit'], kinds: ['LOCATOR'] } });
    expect(r.status).toBe('IMPLEMENTED');
    expect(r.tests[0]!.title).toBe('QA: Clear password field');
    expect(r.tests[0]!.hook).toBe('login-submit');
    expect(r.tests[1]!.title).toBe('QA: Highlight failing field');
    expect(r.tests[1]!.hook).toBe('login-submit'); // round-robin fallback
  });

  it('plans without hooks for non-UI kinds and still traces', () => {
    const r = planTests({ generatedQa: [S1], contract: { hasContract: true, hooks: [], kinds: ['DATA'] } });
    expect(r.status).toBe('IMPLEMENTED');
    expect(r.tests[0]!.hasHook).toBe(false);
  });
});

describe('classifyPlan', () => {
  it('classifies honestly', () => {
    const planned = [{ status: 'PLANNED' as const }];
    const blocked = [{ status: 'BLOCKED' as const }];
    expect(classifyPlan([] as never)).toBe('BLOCKED');
    expect(classifyPlan(planned as never)).toBe('IMPLEMENTED');
    expect(classifyPlan([...planned, ...blocked] as never)).toBe('IMPLEMENTED_WITH_FAILURES');
    const mixed = [planned[0]!, blocked[0]!] as never;
    expect(classifyPlan(mixed)).toBe('IMPLEMENTED_WITH_FAILURES');
  });
});

describe('planSummary', () => {
  it('reports status and counts', () => {
    const t = adfToPlainText(planSummary('IMPLEMENTED_WITH_FAILURES', { planned: 1, blocked: 1 }));
    expect(t).toContain('QA implementation summary');
    expect(t).toContain('status: IMPLEMENTED_WITH_FAILURES');
    expect(t).toContain('Planned: 1');
    expect(t).toContain('Blocked: 1');
  });
});
