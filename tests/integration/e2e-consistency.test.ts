import { beforeEach, describe, expect, it } from 'vitest';
import { adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';
import { doc, para } from '../../src/aialm/oss/alm/adf.ts';
import { persistCandidates, externalMarker } from '../../src/aialm/oss/discover/discover.ts';
import { findingId, runAnalyze } from '../../src/aialm/oss/po/analyzer.ts';
import { importWorkItem } from '../../src/aialm/oss/po/importer.ts';
import { decompose } from '../../src/aialm/oss/po/decomposer.ts';
import { analyzeQa, qaProposalId } from '../../src/aialm/oss/qa/analyzer.ts';
import { applyApprovedQa } from '../../src/aialm/oss/qa/applier.ts';
import { analyzeDev, devProposalId } from '../../src/aialm/oss/dev/analyst.ts';
import { applyApprovedDev } from '../../src/aialm/oss/dev/applier.ts';
import { extractContract, extractGeneratedQa, planTests } from '../../src/aialm/oss/qa/impl.ts';
import { implTargetInputs, planImpl } from '../../src/aialm/oss/dev/impl.ts';
import {
  classifyChild,
  extractGeneratedScenarios,
  makeEvidence,
  prReadiness,
  scenarioResult,
  verifySummaryComment,
} from '../../src/aialm/oss/verify/verify.ts';
import { buildPrBody, prApproved, prGate, prWaveKey, validatePrBody } from '../../src/aialm/oss/pr/pr.ts';
import { classifyComment, needsApproval } from '../../src/aialm/oss/feedback/feedback.ts';
import type { CandidateIssue, ProjectAiProfile } from '../../src/aialm/oss/shared/models.ts';

const AC = 'Scenario: Clear password\nGiven a failed login\nThen the field is empty';
const REPO = 'acme/widgets';
const ISSUE_URL = 'https://github.com/acme/widgets/issues/12';
const TRACE_LINK = 'https://ai-alm-oss.atlassian.net/browse/AIALMOSS';

const profile: ProjectAiProfile = {
  version: 1,
  repo: REPO,
  defaultBranch: 'main',
  languages: ['TypeScript'],
  structure: [],
  issueTemplates: [],
  conventions: { coding: [], test: ['data-testid'] },
  ciCommands: ['npm run typecheck', 'npm test'],
  docsRefs: [],
  labelConventions: [],
  maintainerExpectations: [],
  restrictions: [],
};

const candidate: CandidateIssue = {
  externalIssue: { repo: REPO, number: 12, url: ISSUE_URL },
  issueType: 'bug',
  scope: 'login form',
  ambiguity: 'low',
  codeLocalizability: 'high',
  testability: 'high',
  dependencyRisk: 'low',
  expectedComplexity: 'S',
  conventionFit: 'good',
  implementationConfidence: '0.8',
  recommendation: 'READY',
  rationale: 'clear repro steps',
};

/** Stateful in-memory Jira seam so real module orchestrators compose end-to-end. */
function makeHarness() {
  interface HIssue { key: string; fields: { summary?: string; description?: unknown; labels?: string[]; parent?: { key: string } } }
  const issues = new Map<string, HIssue>();
  const comments = new Map<string, { id: string; bodyAdf: unknown; bodyText: string }[]>();
  const log: string[] = [];
  let counter = 0;
  let commentCounter = 0;

  const jira = {
    getIssue: async (key: string) => {
      const i = issues.get(key);
      if (!i) throw new Error(`missing issue ${key}`);
      return { key: i.key, fields: i.fields };
    },
    listComments: async (key: string) => comments.get(key) ?? [],
    addComment: async (key: string, adf: unknown) => {
      const id = `c${++commentCounter}`;
      const arr = comments.get(key) ?? [];
      arr.push({ id, bodyAdf: adf, bodyText: adfToPlainText(adf) });
      comments.set(key, arr);
      return { id };
    },
    createIssue: async (fields: any) => {
      const key = `WIDG-${++counter}`;
      issues.set(key, { key, fields });
      log.push(`create:${key}`);
      return { key };
    },
    updateIssue: async (key: string, fields: any) => {
      const i = issues.get(key)!;
      i.fields = { ...i.fields, ...fields };
      log.push(`update:${key}`);
    },
    unassign: async (key: string) => {
      log.push(`unassign:${key}`);
    },
    searchJql: async (jql: string) => {
      const parent = /parent = ([A-Za-z0-9_-]+)/.exec(jql)?.[1];
      if (parent) return [...issues.values()].filter(i => i.fields.parent?.key === parent).map(i => ({ key: i.key, fields: i.fields }));
      const label = /labels = ([A-Za-z0-9_-]+)/.exec(jql)?.[1];
      if (label) return [...issues.values()].filter(i => (i.fields.labels ?? []).includes(label)).map(i => ({ key: i.key, fields: i.fields }));
      return [];
    },
  } as any;

  return {
    jira,
    issues,
    log,
    seedIssue: (key: string, fields: HIssue['fields']) => issues.set(key, { key, fields }),
    readIssue: (key: string) => issues.get(key)!,
    approve: async (key: string, id: string) => jira.addComment(key, doc(para(`APPROVE:${id}`))),
  };
}

describe('aialm-oss-e2e-consistency — happy path', () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
  });

  it('produces traceable artifacts in order: issue → work item → QA/contract → tests → READY_FOR_PR → PR with mandated elements', async () => {
    const { jira } = h;

    // discover → candidate issue (READY) with external marker
    const d = await persistCandidates(jira, {
      projectKey: 'WIDG',
      repo: REPO,
      candidates: [{ repo: REPO, number: 12, url: ISSUE_URL, title: 'Login broken', body: 'repro steps', candidate }],
    });
    expect(d.created).toHaveLength(1);
    const candKey = d.created[0]!.key;
    expect(adfToPlainText(h.readIssue(candKey).fields.description as any)).toContain(externalMarker(`${REPO}#12`));

    // po-analyze → proposal comment; approve; po-update-approved → Work Item (DOCK)
    const finding = { issue: 'Clear password on failed auth', why: 'Users cannot tell which field failed.', gherkin: AC, kind: 'NON-BLOCKING' as const };
    const findingId_ = findingId(finding.issue, finding.gherkin);
    await runAnalyze(jira, {
      issueKey: candKey,
      repoRef: `${REPO}#12`,
      analyze: { profile, candidate, issueBody: null, executionSketch: { touchedAreas: ['auth'], riskNotes: [], profileConventionFit: 'good' }, findings: [finding] },
    });
    await h.approve(candKey, findingId_);
    const w = await importWorkItem(jira, {
      projectKey: 'WIDG',
      candidateKey: candKey,
      external: { provider: 'github', repo: REPO, issueNumber: 12, url: ISSUE_URL, syncedAt: '2026-08-24T00:00:00.000Z' },
      title: 'Login broken (normalized)',
    });
    expect(w.status).toBe('CREATED');
    const workKey = w.workItemKey!;
    const workDesc = h.readIssue(workKey).fields.description as any;
    const workText = adfToPlainText(workDesc);
    expect(workText).toContain('## Acceptance Criteria');
    expect(workText).toContain(externalMarker(`${REPO}#12`));
    expect(workText).toContain('externalSource: github');

    // qa-analyze → QA proposal; approve; qa-update-approved → GENERATED QA
    const qa = { sourceProductAC: AC, testObjective: 'Verify password cleared.', kind: 'CORE' as const, scenario: AC, coverageHint: 'UI' as const, rationale: 'observable AC' };
    await analyzeQa(jira, { parentKey: workKey, projectKey: 'WIDG', proposalsByTarget: { [workKey]: [qa] } });
    await h.approve(workKey, qaProposalId(qa));
    await applyApprovedQa(jira, { parentKey: workKey, projectKey: 'WIDG' });
    const withQa = adfToPlainText(h.readIssue(workKey).fields.description as any);
    expect(withQa).toContain('GENERATED QA hash:');

    // dev-analyst → Implementation Contract; approve; dev-update-approved
    const dp = { sourceProductAC: [AC], sourceQaRefs: [qaProposalId(qa)], kind: 'LOCATOR' as const, consumers: ['qa-impl', 'dev-impl'], title: 'submit test id', body: 'Add data-testid="login-submit" to the submit button.' };
    await analyzeDev(jira, { parentKey: workKey, projectKey: 'WIDG', profile, proposalsByTarget: { [workKey]: [dp] } });
    await h.approve(workKey, devProposalId(dp));
    await applyApprovedDev(jira, { parentKey: workKey, projectKey: 'WIDG' });
    const withContract = adfToPlainText(h.readIssue(workKey).fields.description as any);
    expect(withContract).toContain('GENERATED DEV hash:');

    // parallel qa-impl ∥ dev-impl share frozen inputs only (no cross-read)
    const desc = h.readIssue(workKey).fields.description as any;
    const contr = extractContract(desc);
    const planQa = planTests({ generatedQa: extractGeneratedQa(desc), contract: contr });
    const planDev = planImpl(implTargetInputs(desc));
    expect(planQa.status).toBe('IMPLEMENTED');
    expect(planQa.tests[0]!.hook).toBe('login-submit');
    expect(planDev.status).toBe('IMPLEMENTED');
    expect(planDev.slices.some(s => s.kind === 'HOOK' && s.hook === 'login-submit')).toBe(true);
    // no same-wave cross-read: neither plan reads the other's produced specs as input
    expect(planQa.tests[0]!.status).toBe('PLANNED');
    expect(planDev.slices.every(s => s.status === 'PLANNED')).toBe(true);

    // verify → evidence → READY_FOR_PR (all CORE green)
    const scenarios = extractGeneratedScenarios(desc).map(s => scenarioResult(s.scenario, 'pass', s.kind));
    const evidence = [makeEvidence({ command: 'npm run typecheck', exitCode: 0 }), makeEvidence({ command: 'npm test', exitCode: 0 })];
    expect(classifyChild(evidence, scenarios).status).toBe('PASS');
    expect(prReadiness(scenarios).ready).toBe(true);
    expect(adfToPlainText(verifySummaryComment([{ target: workKey, status: 'PASS' }], prReadiness(scenarios)))).toContain('READY_FOR_PR');

    // pr → no PR without verdict + approval; body has all mandated elements; single-PR key
    const waveKey = prWaveKey([workKey]);
    const approved = prApproved([{ id: 'h', bodyText: `APPROVE:${waveKey}` }], waveKey);
    expect(prGate(true, approved).ok).toBe(true);
    const body = buildPrBody({ summary: 'Clear the password field on failed login.', externalRef: `${REPO}#12`, evidenceRefs: ['verify:typecheck pass', 'verify:qa:e2e pass'], limitations: ['login form only'], traceLink: TRACE_LINK });
    expect(validatePrBody(body, { externalRef: `${REPO}#12`, traceLink: TRACE_LINK })).toEqual([]);
    for (const el of ['### Summary', `Fixes ${REPO}#12`, 'Tests / validation', 'Known limitations', 'AI assistant', TRACE_LINK]) {
      expect(body).toContain(el);
    }
    // idempotent single-PR guarantee: same wave → same key
    expect(prWaveKey([workKey])).toBe(waveKey);
  });
});

describe('aialm-oss-e2e-consistency — failure / edge matrix', () => {
  function fresh() { return makeHarness(); }

  it('never imports a candidate without approval (BLOCKED, no create) and never invents info', async () => {
    const h = fresh();
    const candKey = 'WIDG-1';
    h.seedIssue(candKey, { summary: '[candidate] acme/widgets#12 — Login broken', description: doc(para('x')), labels: ['candidate', 'READY'] });
    const w = await importWorkItem(h.jira, {
      projectKey: 'WIDG', candidateKey: candKey,
      external: { provider: 'github', repo: REPO, issueNumber: 12, url: ISSUE_URL, syncedAt: 'T' }, title: 'Login broken',
    });
    expect(w.status).toBe('BLOCKED');
    expect(h.log.some(l => l.startsWith('create:WIDG-2'))).toBe(false);
  });

  it('duplicate import is SKIPPED by externalSource key (no second work item)', async () => {
    const h = fresh();
    const candKey = 'WIDG-1';
    h.seedIssue(candKey, { summary: '[candidate] acme/widgets#12 — Login broken', description: doc(para('x')), labels: ['candidate', 'READY'] });
    const finding = { issue: 'Clear password', why: 'why', gherkin: AC, kind: 'NON-BLOCKING' as const };
    const id = findingId(finding.issue, finding.gherkin);
    await runAnalyze(h.jira, { issueKey: candKey, repoRef: `${REPO}#12`, analyze: { profile, candidate, issueBody: null, executionSketch: { touchedAreas: [], riskNotes: [], profileConventionFit: 'good' }, findings: [finding] } });
    await h.approve(candKey, id);
    // a work item already imported for this external ref already exists in the repo project
    h.seedIssue('WIDG-99', { summary: 'Login broken', description: doc(para('## Acceptance Criteria'), para(externalMarker(`${REPO}#12`))), labels: ['work-item'] });
    const w = await importWorkItem(h.jira, {
      projectKey: 'WIDG', candidateKey: candKey,
      external: { provider: 'github', repo: REPO, issueNumber: 12, url: ISSUE_URL, syncedAt: 'T' }, title: 'Login broken',
    });
    expect(w.status).toBe('SKIPPED');
    expect(w.workItemKey).toBe('WIDG-99');
    expect(h.log.filter(l => l.startsWith('create:')).length).toBe(0);
  });

  it('decompose without an approved package does not create children', async () => {
    const h = fresh();
    h.seedIssue('WIDG-9', { summary: 'P', description: doc(para('## Acceptance Criteria'), { type: 'codeBlock', content: [{ type: 'text', text: AC }] }), labels: ['work-item'] });
    const res = await decompose(h.jira, { parentKey: 'WIDG-9', projectKey: 'WIDG' });
    expect(res.status).toBe('BLOCKED');
    expect(h.log.filter(l => l.startsWith('create:')).length).toBe(0);
  });

  it('exclusive mode isolates children; a child without AC is blocked per child only', async () => {
    const h = fresh();
    h.seedIssue('WIDG-9', { summary: 'P', description: doc(para('## Acceptance Criteria')), labels: ['work-item'] });
    h.seedIssue('WIDG-100', { summary: 'Child A', description: doc(para('## Acceptance Criteria'), { type: 'codeBlock', content: [{ type: 'text', text: AC }] }), parent: { key: 'WIDG-9' } });
    h.seedIssue('WIDG-101', { summary: 'Child B', description: doc(para('no AC')), parent: { key: 'WIDG-9' } });
    const qa = { sourceProductAC: AC, testObjective: 'o', kind: 'CORE' as const, scenario: AC, rationale: 'r', coverageHint: 'UI' as const };
    const r = await analyzeQa(h.jira, { parentKey: 'WIDG-9', projectKey: 'WIDG', proposalsByTarget: { 'WIDG-100': [qa], 'WIDG-101': [qa] } });
    const byKey = Object.fromEntries(r.targets.map(t => [t.key, t.blocked]));
    expect(byKey['WIDG-100']).toBe(false);
    expect(byKey['WIDG-101']).toBe(true);
    expect(r.rows.find(x => x.target === 'WIDG-101')!.status).toBe('BLOCKED');
  });

  it('impl without a contract (hooks needed) is BLOCKED; no silent inventing', async () => {
    const h = fresh();
    const desc = doc(para('## Acceptance Criteria'), { type: 'codeBlock', content: [{ type: 'text', text: AC }] }, para('GENERATED QA hash: abc'), { type: 'codeBlock', content: [{ type: 'text', text: AC }] }, para('END GENERATED QA'));
    const plan = planImpl(implTargetInputs(desc));
    expect(plan.status).toBe('BLOCKED');
    expect(plan.blockedReasons[0]).toContain('Implementation Contract');
  });

  it('verify: READY_FOR_PR only with all-CORE green evidence; blocked when a CORE fails', () => {
    const coreFail = [scenarioResult(AC, 'fail', 'CORE')];
    const corePass = [scenarioResult(AC, 'pass', 'CORE'), scenarioResult(AC, 'fail', 'EDGE')];
    expect(prReadiness(coreFail).ready).toBe(false);
    expect(prReadiness(corePass).ready).toBe(true); // non-core may fail
    expect(classifyChild([makeEvidence({ command: 'x', exitCode: 1 })], []).status).toBe('FAILED');
  });

  it('pr: no PR without both the READY verdict and the approval gate', () => {
    expect(prGate(false, true).ok).toBe(false);
    expect(prGate(true, false).ok).toBe(false);
    expect(prGate(true, true).ok).toBe(true);
  });

  it('feedback: SCOPE_CHANGE / BLOCKER require re-approval; classification is deterministic', () => {
    expect(classifyComment('this is a scope change, we also need X')).toBe('SCOPE_CHANGE');
    expect(needsApproval('SCOPE_CHANGE')).toBe(true);
    expect(needsApproval('BLOCKER')).toBe(true);
    expect(needsApproval('STYLE')).toBe(false);
    expect(classifyComment('this is a bug, it crashes')).toBe('BUG');
  });

  it('parseQaProposal never leaks locators into GENERATED QA and keeps them in the contract', async () => {
    const h = fresh();
    const desc = doc(
      para('## Acceptance Criteria'), { type: 'codeBlock', content: [{ type: 'text', text: AC }] },
      para('GENERATED QA hash: abc'), para('# kind: CORE'), { type: 'codeBlock', content: [{ type: 'text', text: AC }] }, para('END GENERATED QA'),
      para('## Implementation Contract'), para('GENERATED DEV hash: def'), para('# kind: LOCATOR'), para('data-testid="login-submit"'), para('END GENERATED DEV'),
    );
    const gen = extractGeneratedQa(desc);
    // behavioral leakage regression: generated scenarios carry no testid/locator mandates
    expect(JSON.stringify(gen)).not.toMatch(/data-testid|getBy|#id=/);
    // locator appears only in the contract
    const contr = extractContract(desc);
    expect(contr.hooks).toContain('login-submit');
  });
});
