import { describe, expect, it } from 'vitest';
import {
  aiProposalIds,
  allProposalsDecided,
  approvesProposal,
  hasHumanApprovalFor,
  rejectsProposal,
  type ApprovalComment,
} from '../../src/aialm/oss/shared/approval.ts';

const c = (body: string, isAi = false): ApprovalComment => ({ id: 'x', body, isAiGenerated: isAi });

describe('approvesProposal', () => {
  it('accepts APPROVE:<id>', () => {
    expect(approvesProposal(c('APPROVE:0ab12cd'), '0ab12cd')).toBe(true);
  });

  it('accepts approve/lgtm variants with or without colon', () => {
    for (const body of ['approve 0ab12cd', 'LGTM #0ab12cd', 'lgtm:0ab12cd']) {
      expect(approvesProposal(c(body), '0ab12cd')).toBe(true);
    }
  });

  it('rejects wrong id', () => {
    expect(approvesProposal(c('APPROVE:ffffff1'), '0ab12cd')).toBe(false);
  });

  it('accepts a green checkmark emoji without an id', () => {
    expect(approvesProposal(c('✅'), '0ab12cd')).toBe(true);
    expect(approvesProposal(c('✔️'), '0ab12cd')).toBe(true);
    expect(approvesProposal(c('approved ✓ thx'), '0ab12cd')).toBe(true);
  });

  it('never counts AI-authored comments', () => {
    expect(approvesProposal(c('APPROVE:0ab12cd', true), '0ab12cd')).toBe(false);
    expect(approvesProposal(c('[AI-generated] summary — APPROVE:0ab12cd'), '0ab12cd')).toBe(false);
    expect(approvesProposal(c('✅', true), '0ab12cd')).toBe(false);
    expect(approvesProposal(c('[AI-generated] ✅'), '0ab12cd')).toBe(false);
  });

  it('explicit trash-reject wins over approval', () => {
    expect(rejectsProposal(c('🗑️:0ab12cd'), '0ab12cd')).toBe(true);
    expect(approvesProposal(c('🗑️:0ab12cd APPROVE:0ab12cd'), '0ab12cd')).toBe(false);
    expect(approvesProposal(c('🗑️:0ab12cd ✅'), '0ab12cd')).toBe(false);
  });
});

describe('hasHumanApprovalFor', () => {
  it('scans a comment list', () => {
    const comments = [
      c('[AI-generated] Proposal footer proposal:0ab12cd', true),
      c('looks good'),
      c('APPROVE:0ab12cd'),
    ];
    expect(hasHumanApprovalFor(comments, '0ab12cd')).toBe(true);
    expect(hasHumanApprovalFor(comments.slice(0, 2), '0ab12cd')).toBe(false);
  });
});

describe('aiProposalIds / allProposalsDecided', () => {
  it('collects proposal ids only from AI proposal comments', () => {
    const comments = [
      c('[AI-generated] Proposal — X — aialm-oss-po-analyze:0ab12cd\nproposal:0ab12cd', true),
      c('[AI-generated] summary Proposals: 0ab12cd, ffffff1', true), // no proposal: marker → ignored
      c('APPROVE:0ab12cd'), // human → ignored as proposer
    ];
    expect(aiProposalIds(comments)).toEqual(['0ab12cd']);
  });

  it('false while a proposal is undecided, true once approved or rejected', () => {
    const prop = c('[AI-generated] Proposal proposal:0ab12cd', true);
    expect(allProposalsDecided([prop])).toBe(false);
    expect(allProposalsDecided([prop, c('APPROVE:0ab12cd')])).toBe(true);
    expect(allProposalsDecided([prop, c('🗑️:0ab12cd')])).toBe(true);
    expect(allProposalsDecided([prop, c('✅')])).toBe(true);
  });

  it('parses the marker when adfToPlainText glues paragraphs together (no separator)', () => {
    // Real-world regression: "…aialm-oss-discover:<id>" + "proposal:<id>" render as
    // one glued string ("…<id>proposal:<id>…"), so a leading \b would never match.
    const glued = c('[AI-generated] Proposal — X — aialm-oss-discover:0ab12cdproposal:0ab12cdacme/widgets', true);
    expect(aiProposalIds([glued])).toEqual(['0ab12cd']);
    expect(hasHumanApprovalFor([glued, c('✅')], '0ab12cd')).toBe(true);
  });
});
