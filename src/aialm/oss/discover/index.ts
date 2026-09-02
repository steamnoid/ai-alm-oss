/**
 * aialm-oss-discover — orchestrator (aialm-oss-discover).
 *
 * Scan open issues of an onboarded repo, qualify each plausible candidate,
 * persist as `candidate`-labeled issues in the repo's tracking project,
 * and report CREATED / SKIPPED per recommendation.
 */
import type { JiraClient } from '../adapter/jira.js';
import { GithubClient, type IssueRef } from '../adapter/github.js';
import { persistCandidates, type PersistResult } from './persist.js';
import {
  CandidateRecommendation,
  summaryForCandidate,
  type CandidateIssue,
} from './candidate.js';

export interface DiscoverInput {
  owner: string;
  repo: string;
  projectKey: string;
}

export interface DiscoverResult {
  projectKey: string;
  persist: PersistResult;
  /** Kraje po recommendation dla raportu. */
  summary: Record<CandidateRecommendation, { created: number; skipped: number }>;
}

/**
 * Build a deterministic `CandidateIssue` qualification from an issue.
 *
 * V1: pola wypełniane heurystyką z IssueRef (konwencja użyteczności, issue
 * templates). Agent (model) może zastąpić to własnym osądem LLM przed persist —
 * struktura jest stała, wartości są deklaratywne.
 */
export function qualifyIssue(issue: IssueRef): CandidateIssue {
  const text = `${issue.title}\n${issue.body ?? ''}`.toLowerCase();
  const hasBody = !!issue.body?.trim();

  const scope =
    /^fix|^bug|^hotfix/.test(issue.title) ? 'bugfix' : 'feature';
  const codeLocalizability = hasBody && /\.(ts|js|py|go|rs|java|kt|swift|cs)/.test(text) ? 'high' : 'medium';
  const testability = hasBody ? 'medium' : 'low';
  const ambiguity = !hasBody ? 'high' : /(?:todo|wip|later|needs discussion|open question)/.test(text) ? 'high' : 'low';
  const dependencyRisk = text.includes('credentials') || text.includes('api key') || text.includes('private infra') ? 'high' : 'low';
  const expectedComplexity = text.length > 4000 ? 'high' : 'medium';
  const conventionFit = 'medium';
  const implementationConfidence =
    ambiguity === 'low' && dependencyRisk === 'low' ? 'high' : 'medium';

  let recommendation: CandidateRecommendation;
  if (dependencyRisk === 'high') recommendation = 'BLOCKED';
  else if (ambiguity === 'high') recommendation = 'NEEDS-CLARIFICATION';
  else recommendation = 'READY';

  const rationale = [
    `scope=${scope}`,
    `body=${hasBody ? 'present' : 'missing'}`,
    `ambiguity=${ambiguity}`,
    `dependency_risk=${dependencyRisk}`,
  ].join(', ');

  return {
    issueType: scope,
    scope,
    ambiguity,
    codeLocalizability,
    testability,
    dependencyRisk,
    expectedComplexity,
    conventionFit,
    implementationConfidence,
    recommendation,
    rationale,
  };
}

export async function runDiscover(jira: JiraClient, gh: GithubClient, input: DiscoverInput): Promise<DiscoverResult> {
  const issues = await gh.listOpenIssues(input.owner, input.repo);

  const candidates = issues.map(issue => ({
    number: issue.number,
    url: issue.html_url ?? `${'https://github.com'}/${input.owner}/${input.repo}/issues/${issue.number}`,
    title: issue.title,
    body: issue.body ?? null,
    candidate: qualifyIssue(issue),
  }));

  const persist = await persistCandidates(jira, {
    projectKey: input.projectKey,
    repo: `${input.owner}/${input.repo}`,
    candidates,
  });

  const createdRefs = new Set(persist.created.map(p => p.ref));
  const skippedRefs = new Set(persist.skipped.map(s => s.ref));

  const summary: DiscoverResult['summary'] = {
    READY: { created: 0, skipped: 0 },
    'NEEDS-CLARIFICATION': { created: 0, skipped: 0 },
    BLOCKED: { created: 0, skipped: 0 },
    UNSUITABLE: { created: 0, skipped: 0 },
  };
  for (const c of candidates) {
    const s = summary[c.candidate.recommendation];
    const ref = `${input.owner}/${input.repo}#${c.number}`;
    if (!s) continue;
    if (createdRefs.has(ref)) s.created += 1;
    else if (skippedRefs.has(ref)) s.skipped += 1;
  }

  return { projectKey: input.projectKey, persist, summary };
}

export { summaryForCandidate };