import { JiraClient } from '../alm/jira.ts';
import { bullets, codeBlock, doc, para, type AdfNode } from '../alm/adf.ts';
import { proposalHeader, proposalIdFor } from '../shared/identity.ts';
import { assignRoleApprover } from '../governance/roles.ts';
import type { CandidateIssue } from '../shared/models.ts';

export function externalRef(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/** Stable marker embedded in every candidate issue description (idempotency key). */
export function externalMarker(ref: string): string {
  return `aialm-external: ${ref}`;
}

export function buildCandidateDoc(input: {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string | null;
  candidate: CandidateIssue;
}) {
  const c = input.candidate;
  const ref = externalRef(input.repo, input.number);
  return doc(
    para({ t: 'Candidate Qualification', b: true }),
    para({ t: 'Source: ', }, { t: `${ref}`, c: true }, ` — ${input.url}`),
    para({ t: 'Issue title: ' }, input.title),
    para('Issue body:', ),
    codeBlock((input.body ?? '(empty)').slice(0, 4000)),
    para({ t: 'Qualification', b: true }),
    bullets([
      ['issue_type: ', { t: c.issueType, c: true }],
      ['scope: ', c.scope],
      ['ambiguity: ', c.ambiguity],
      ['code_localizability: ', c.codeLocalizability],
      ['testability: ', c.testability],
      ['dependency_risk: ', c.dependencyRisk],
      ['expected_complexity: ', c.expectedComplexity],
      ['convention_fit: ', c.conventionFit],
      ['implementation_confidence: ', c.implementationConfidence],
      [{ t: `recommendation: ${c.recommendation}`, b: true }],
      ['rationale: ', c.rationale],
    ]),
    para({ t: externalMarker(ref), c: true }),
  );
}

export function summaryForCandidate(input: { repo: string; number: number; title: string }): string {
  return `[candidate] ${input.repo}#${input.number} — ${input.title}`;
}

/** Extract the aialm-external marker from an issue description (plain text or ADF JSON). */
export function extractExternalRef(text: string): string | null {
  // strict ref shape: owner/name#123 (stops cleanly even inside JSON-stringified ADF)
  const m = /aialm-external:\s*([\w.-]+\/[\w.-]+#\d+)\b/.exec(text);
  return m ? (m[1] as string) : null;
}

export interface PersistResult {
  created: { ref: string; key: string }[];
  skipped: { ref: string; reason: string }[];
}

/**
 * Persist qualified candidates as issues in the repo's tracking project.
 * Idempotent by aialm-external marker — already-imported refs are SKIPPED.
 */
export async function persistCandidates(
  jira: JiraClient,
  opts: {
    projectKey: string;
    repo: string;
    candidates: Parameters<typeof buildCandidateDoc>[0][];
  },
): Promise<PersistResult> {
  const result: PersistResult = { created: [], skipped: [] };

  // collect refs already present among candidate-labeled issues in this project
  const existing = await jira.searchJql(
    `project = ${opts.projectKey} AND labels = candidate`,
    ['description'],
  );
  const knownRefs = new Set<string>();
  for (const it of existing) {
    const ref = extractExternalRef(JSON.stringify(it.fields?.description ?? {}));
    if (ref) knownRefs.add(ref);
  }

  for (const input of opts.candidates) {
    const ref = externalRef(opts.repo, input.number);
    if (knownRefs.has(ref)) {
      result.skipped.push({ ref, reason: 'already imported' });
      continue;
    }
    const created = await jira.createIssue({
      project: { key: opts.projectKey },
      issuetype: { id: '10008' }, // Task
      summary: summaryForCandidate({ repo: opts.repo, number: input.number, title: input.title }),
      description: buildCandidateDoc(input),
      labels: ['candidate', input.candidate.recommendation],
    });
    // Candidate selection gate (same convention as every other gate):
    // a proposal the human must approve before po-analyze runs.
    const id = selectionProposalId({ repo: opts.repo, number: input.number, recommendation: input.candidate.recommendation });
    await jira.addComment(created.key, doc(
      para({ t: proposalHeader(created.key, 'aialm-oss-discover', id), b: true }),
      para({ t: `proposal:${id}`, c: true }),
      para({ t: `${externalRef(opts.repo, input.number)} (${input.candidate.recommendation}) — ${input.title}` }),
      para(input.url),
      para('Qualified READY — approve to execute this candidate through the governed pipeline.'),
      para('AI proposes; a human approves by commenting ✅ (or APPROVE:<id>).'),
    ));
    await assignRoleApprover(jira, created.key, 'po');
    result.created.push({ ref, key: created.key });
  }
  return result;
}


/** Candidate selection gate — one proposal per candidate (same convention as other gates). */
export function selectionProposalId(input: { repo: string; number: number; recommendation: string }): string {
  return proposalIdFor(`candidate-selection\n${input.repo}\n${input.number}\n${input.recommendation}`);
}

export function buildSelectionProposalDoc(input: { repo: string; number: number; title: string; url: string; recommendation: string }): AdfNode {
  const id = selectionProposalId({ repo: input.repo, number: input.number, recommendation: input.recommendation });
  return doc(
    para({ t: `[AI-generated] Proposal — candidate selection — aialm-oss-discover:${id}`, b: true }),
    para({ t: `proposal:${id}`, c: true }),
    para({ t: `${externalRef(input.repo, input.number)} (${input.recommendation}) — ${input.title}` }),
    para(input.url),
    para('Qualified READY — approve to execute this candidate through the governed pipeline.'),
    para('AI proposes; a human approves by commenting ✅ (or APPROVE:<id>).'),
  );
}
