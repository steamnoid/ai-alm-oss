import { describe, expect, it } from 'vitest';
import {
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

  it('never counts AI-authored comments', () => {
    expect(approvesProposal(c('APPROVE:0ab12cd', true), '0ab12cd')).toBe(false);
    expect(approvesProposal(c('[AI-generated] summary — APPROVE:0ab12cd'), '0ab12cd')).toBe(false);
  });

  it('explicit trash-reject wins over approval', () => {
    expect(rejectsProposal(c('🗑️:0ab12cd'), '0ab12cd')).toBe(true);
    expect(approvesProposal(c('🗑️:0ab12cd APPROVE:0ab12cd'), '0ab12cd')).toBe(false);
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
