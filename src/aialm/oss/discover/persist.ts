/**
 * aialm-oss-discover — persist qualified candidates into the repo's tracking
 * project. Idempotent po kluczu `aialm-external:`.
 *
 * AGENTS.md "Discover persist": nowy kandydat dostaje
 * STAGE=AWAITING_HUMAN_APPROVAL / ROLE=PO / AGENT=none + native Jira "To Do".
 */
import type { JiraClient } from '../adapter/jira.js';
import { markdownToAdf } from '../adapter/adf.js';
import { ensureSelfAwareFields, type SelfAwareCids } from '../adapter/fields-config.js';
import {
  externalMarker,
  externalRef,
  extractExternalRef,
  summaryForCandidate,
  type CandidateIssue,
} from './candidate.js';

export interface PersistResult {
  created: Array<{ ref: string; key: string }>;
  skipped: Array<{ ref: string; reason: string }>;
}

export function buildCandidateMarkdown(input: {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string | null;
  candidate: CandidateIssue;
}): string {
  const c = input.candidate;
  const ref = externalRef(input.repo, input.number);
  return [
    '## Candidate Qualification',
    '',
    `Source: \`${ref}\` — ${input.url}`,
    `Issue title: ${input.title}`,
    '',
    'Issue body:',
    '```',
    (input.body ?? '(empty)').slice(0, 4000),
    '```',
    '',
    '## Qualification',
    `- issue_type: ${c.issueType}`,
    `- scope: ${c.scope}`,
    `- ambiguity: ${c.ambiguity}`,
    `- code_localizability: ${c.codeLocalizability}`,
    `- testability: ${c.testability}`,
    `- dependency_risk: ${c.dependencyRisk}`,
    `- expected_complexity: ${c.expectedComplexity}`,
    `- convention_fit: ${c.conventionFit}`,
    `- implementation_confidence: ${c.implementationConfidence}`,
    `- **recommendation: ${c.recommendation}**`,
    `- rationale: ${c.rationale}`,
    '',
    externalMarker(ref),
  ].join('\n');
}

export const STATE_FIELDS = {
  stage: 'AIALM STAGE',
  role: 'AIALM ROLE',
  agent: 'AIALM AGENT',
} as const;

/**
 * Resolve the per-klient self-aware field CIDs (creating the fields if the
 * onboarding didn't already provision them). Returns stage/role/agent CIDs.
 */
export async function resolveStateCids(jira: JiraClient, projectKey: string): Promise<SelfAwareCids> {
  return ensureSelfAwareFields(jira, projectKey);
}

export async function persistCandidates(
  jira: JiraClient,
  opts: {
    projectKey: string;
    repo: string;
    candidates: Array<{ number: number; url: string; title: string; body: string | null; candidate: CandidateIssue }>;
  },
): Promise<PersistResult> {
  const result: PersistResult = { created: [], skipped: [] };

  // Already-present refs among candidate-labeled issues in this project.
  const existing = await jira.searchJql(`project = ${opts.projectKey} AND labels = candidate`, [
    'description',
  ]);
  const knownRefs = new Set<string>();
  for (const it of existing) {
    const desc = (it.fields as { description?: unknown } | undefined)?.description;
    const ref = extractExternalRef(JSON.stringify(desc ?? ''));
    if (ref) knownRefs.add(ref);
  }

  const taskTypeId = await jira.issueTypeId(opts.projectKey, 'Task');
  // Resolve CIDs once (creates fields if onboarding didn't provision them).
  const cids = await resolveStateCids(jira, opts.projectKey);

  for (const c of opts.candidates) {
    const ref = externalRef(opts.repo, c.number);
    if (knownRefs.has(ref)) {
      result.skipped.push({ ref, reason: 'already exists' });
      continue;
    }
    const md = buildCandidateMarkdown({ repo: opts.repo, ...c });
    const issue = await jira.createIssue({
      project: { key: opts.projectKey },
      issuetype: { id: taskTypeId },
      summary: summaryForCandidate(opts.repo, c.number, c.title),
      description: markdownToAdf(md),
      labels: ['candidate', c.candidate.recommendation],
    });
    // AGENTS.md: STAGE=AWAITING_HUMAN_APPROVAL / ROLE=PO / AGENT=none.
    await jira.updateState(
      issue.key,
      { stage: 'AWAITING_HUMAN_APPROVAL', role: 'PO', agent: 'none' },
      { stage: cids.stage, role: cids.role, agent: cids.agent },
    );
    result.created.push({ ref, key: issue.key });
  }
  return result;
}