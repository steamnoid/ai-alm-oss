/** Shared OSS ALM domain models (aialm-oss-shared §7). */

export interface ExternalSource {
  provider: 'github';
  repo: string; // owner/name
  issueNumber: number;
  url: string;
  syncedAt: string; // ISO
}

export type EvidenceResult = 'pass' | 'fail' | 'error';

export interface EvidenceEntry {
  stage: 'import' | 'analyze' | 'decompose' | 'qa' | 'dev' | 'impl' | 'verify' | 'pr' | 'feedback';
  command?: string;
  artifactRef?: string;
  result?: EvidenceResult;
  timestamp: string; // ISO
}

export interface PullRequestTrace {
  prUrl: string;
  commits: string[];
  workItemIds: string[]; // Jira keys of the wave (epic + stories)
}

export type FeedbackCategory =
  | 'CLARIFICATION'
  | 'BUG'
  | 'MISSING_TEST'
  | 'STYLE'
  | 'ARCHITECTURE'
  | 'SCOPE_CHANGE'
  | 'BLOCKER';

export interface FeedbackRecord {
  source: 'maintainer';
  category: FeedbackCategory;
  rawRef: string; // e.g. "owner/repo#12/comment-987"
  disposition: string;
}

export interface AccessGrant {
  who: string; // email or accountId
  projectKey: string;
  role: 'viewer';
  requestedBy?: string;
  approvedBy: string; // who clicked ✅ / commented APPROVE:<id>
  grantedAt: string; // ISO
  revokedAt?: string;
}

export type CandidateRecommendation = 'READY' | 'NEEDS-CLARIFICATION' | 'UNSUITABLE' | 'BLOCKED';

/** Qualification model produced by aialm-oss-discover (V0 contract). */
export interface CandidateIssue {
  externalIssue: { repo: string; number: number; url: string };
  issueType: string;
  scope: string;
  ambiguity: string;
  codeLocalizability: string;
  testability: string;
  dependencyRisk: string;
  expectedComplexity: string;
  conventionFit: string;
  implementationConfidence: string;
  recommendation: CandidateRecommendation;
  rationale: string;
}

/** Project AI Profile (onboard output) — immutable during an execution wave. */
export interface ProjectAiProfile {
  version: number;
  repo: string; // owner/name
  defaultBranch?: string;
  languages: string[];
  structure: string[];
  contributing?: string;
  issueTemplates: string[];
  prTemplate?: string;
  conventions: { coding: string[]; test: string[] };
  ciCommands: string[];
  docsRefs: string[];
  labelConventions: string[];
  maintainerExpectations: string[];
  restrictions: string[];
  jiraProjectKey?: string;
}
