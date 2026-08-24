import { describe, expect, it } from 'vitest';
import {
  classifyChild,
  extractGeneratedScenarios,
  makeEvidence,
  prReadiness,
  scenarioIdFor,
  scenarioResult,
  verifySummaryComment,
} from '../../src/aialm/oss/verify/verify.ts';
import { adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';
import { codeBlock, doc, para } from '../../src/aialm/oss/alm/adf.ts';

const S1 = 'Scenario: Clear password field\nGiven a failed login\nThen the field is empty';
const S2 = 'Scenario: Highlight field\nGiven a failed login\nThen it is underlined';

function genBlock() {
  return doc(
    para({ t: 'GENERATED QA hash: abc1234', c: true }),
    para({ t: '# source: x', c: true }),
    para({ t: '# kind: CORE', c: true }),
    codeBlock(S1),
    para({ t: '# kind: EDGE', c: true }),
    codeBlock(S2),
    para({ t: 'END GENERATED QA', c: true }),
  );
}

describe('makeEvidence — capture integrity', () => {
  it('maps exit code to pass/fail and errored to error', () => {
    expect(makeEvidence({ command: 'npm run typecheck', exitCode: 0, now: 'T' }).result).toBe('pass');
    expect(makeEvidence({ command: 'npm test', exitCode: 1, now: 'T' }).result).toBe('fail');
    expect(makeEvidence({ command: 'npm run e2e', exitCode: 1, errored: true, now: 'T' }).result).toBe('error');
  });

  it('keeps command, artifactRef and timestamp', () => {
    const e = makeEvidence({ command: 'npm test', exitCode: 0, artifactRef: 'logs/test.log', now: '2026-01-01T00:00:00Z' });
    expect(e.stage).toBe('verify');
    expect(e.command).toBe('npm test');
    expect(e.artifactRef).toBe('logs/test.log');
    expect(e.timestamp).toBe('2026-01-01T00:00:00Z');
  });
});

describe('extractGeneratedScenarios', () => {
  it('pairs each scenario with its kind', () => {
    const r = extractGeneratedScenarios(genBlock());
    expect(r).toEqual([
      { scenario: S1, kind: 'CORE' },
      { scenario: S2, kind: 'EDGE' },
    ]);
  });
});

describe('scenarioIdFor / scenarioResult', () => {
  it('is deterministic and traceable', () => {
    expect(scenarioIdFor(S1)).toBe(scenarioIdFor(S1));
    expect(scenarioIdFor(S1)).toMatch(/^[0-9a-f]{7}$/);
    const r = scenarioResult(S1, 'pass', 'CORE');
    expect(r.testTitle).toBe('QA: Clear password field');
    expect(r.kind).toBe('CORE');
    expect(r.outcome).toBe('pass');
  });
});

describe('classifyChild', () => {
  it('BLOCKS with no evidence or a command error', () => {
    expect(classifyChild([], []).status).toBe('BLOCKED');
    expect(classifyChild([makeEvidence({ command: 'x', exitCode: 1, errored: true })], []).status).toBe('BLOCKED');
  });

  it('FAILED when a command or scenario fails', () => {
    const ev = [makeEvidence({ command: 'typecheck', exitCode: 1 })];
    const ok = [scenarioResult(S1, 'pass', 'CORE')];
    const fail = [scenarioResult(S1, 'fail', 'CORE')];
    expect(classifyChild(ev, ok).status).toBe('FAILED');
    expect(classifyChild([makeEvidence({ command: 'typecheck', exitCode: 0 })], fail).status).toBe('FAILED');
  });

  it('PASS only when all command evidence and all scenarios are green', () => {
    const ev = [makeEvidence({ command: 'typecheck', exitCode: 0 }), makeEvidence({ command: 'test', exitCode: 0 })];
    const sc = [scenarioResult(S1, 'pass', 'CORE'), scenarioResult(S2, 'pass', 'EDGE')];
    expect(classifyChild(ev, sc)).toEqual({ status: 'PASS' });
  });

  it('PARTIAL for incomplete but error-free coverage', () => {
    const ev = [makeEvidence({ command: 'typecheck', exitCode: 0 })];
    expect(classifyChild(ev, []).status).toBe('PARTIAL'); // no scenarios mapped
  });
});

describe('prReadiness', () => {
  it('READY only when all CORE scenarios pass (non-core may fail)', () => {
    const sc = [scenarioResult(S1, 'pass', 'CORE'), scenarioResult(S2, 'fail', 'EDGE')];
    const v = prReadiness(sc);
    expect(v.ready).toBe(true);
    expect(v.reason).toContain('all CORE scenarios green');
  });

  it('NOT ready when a CORE scenario is not green or none exist', () => {
    expect(prReadiness([scenarioResult(S1, 'fail', 'CORE')]).ready).toBe(false);
    expect(prReadiness([scenarioResult(S1, 'pass', 'EDGE')]).ready).toBe(false); // no core
  });
});

describe('verifySummaryComment', () => {
  it('reports per-target status and the PR verdict', () => {
    const t = adfToPlainText(verifySummaryComment([{ target: 'WIDG-100', status: 'PASS' }], { ready: true, reason: 'all CORE scenarios green' }));
    expect(t).toContain('Verification evidence summary');
    expect(t).toContain('PASS WIDG-100');
    expect(t).toContain('PR readiness: READY_FOR_PR');
  });
});
