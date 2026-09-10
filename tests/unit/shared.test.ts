import { describe, it, expect } from 'vitest';
import { normalize, proposalIdFor, proposalHeader, isAiMarked } from '../../src/aialm/oss/shared/identity.js';
import { parseProposalHeader, Sections, proposalMarker } from '../../src/aialm/oss/shared/markers.js';
import { hasHumanApprovalFor } from '../../src/aialm/oss/shared/approval.js';
import { renderStatusSummary, REPORT_STATUSES } from '../../src/aialm/oss/shared/status.js';

describe('proposal id', () => {
  it('is stable under whitespace/case/entity differences', () => {
    expect(proposalIdFor('Add  A feature')).toBe(proposalIdFor('add a feature'));
    expect(proposalIdFor('a &amp; b')).toBe(proposalIdFor('a & b'));
    expect(proposalIdFor('x')).toBe(proposalIdFor(' x '));
  });

  it('is deterministic across calls', () => {
    expect(proposalIdFor('stable payload')).toBe(proposalIdFor('stable payload'));
  });

  it('returns 7 lowercase hex digits', () => {
    expect(proposalIdFor('anything')).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('identity & markers', () => {
  it('proposalHeader uses canonical AI mark and skill:id', () => {
    const h = proposalHeader('AAO-1', 'aialm-oss-po-analyze', 'abc1234');
    expect(h).toMatch(/^\[AI-generated\] Proposal — AAO-1 — aialm-oss-po-analyze:abc1234$/);
  });

  it('isAiMarked is tolerant of missing brackets', () => {
    expect(isAiMarked('[AI-generated] Proposal')).toBe(true);
    expect(isAiMarked('AI-generated Proposal')).toBe(true);
    expect(isAiMarked('humane text')).toBe(false);
    expect(isAiMarked(null)).toBe(false);
  });

  it('parseProposalHeader round-trips a generated header', () => {
    const h = proposalHeader('AAO-1', 'aialm-oss-dev-impl', 'def4567');
    expect(parseProposalHeader(h)).toEqual({ issueKey: 'AAO-1', skill: 'aialm-oss-dev-impl', id: 'def4567' });
    expect(parseProposalHeader('human comment')).toBeNull();
  });

  it('sections and proposal marker helpers expose constants', () => {
    expect(Sections.productAc).toBe('## Product AC');
    expect(proposalMarker('aialm-oss-qa-analyze')).toBe('aialm-oss-qa-analyze');
  });
});

describe('human approval', () => {
  const aiC = (body: string, reactions: Array<{ emoji: string; isAi: boolean }> = []) => ({
    body: `[AI-generated] ${body}`,
    isAi: true,
    reactions,
  });
  const humanC = (body: string, reactions: Array<{ emoji: string; isAi: boolean }> = []) => ({
    body,
    isAi: false,
    reactions,
  });

  it('human APPROVE:<id> approves', () => {
    expect(hasHumanApprovalFor([aiC('proposal:abc1234 plan'), humanC('APPROVE:abc1234')], 'abc1234')).toBe(true);
  });

  it('human ✅ reaction on the AI proposal comment approves', () => {
    expect(
      hasHumanApprovalFor(
        [aiC('proposal:abc1234 plan with reactions', [{ emoji: '✅', isAi: false }])],
        'abc1234',
      ),
    ).toBe(true);
  });

  it('AI reaction on the proposal does NOT approve', () => {
    expect(hasHumanApprovalFor([aiC('proposal:abc1234 plan')], 'abc1234')).toBe(false);
    expect(hasHumanApprovalFor([aiC('proposal:abc1234 plan'), humanC('ok', [{ emoji: '👍', isAi: true }])], 'abc1234')).toBe(false);
  });

  it('unrelated emoji or missing id does NOT approve', () => {
    expect(hasHumanApprovalFor([humanC('ok', [{ emoji: '🎉', isAi: false }])], 'abc1234')).toBe(false);
    expect(hasHumanApprovalFor([humanC('APPROVE:other')], 'abc1234')).toBe(false);
  });

  it('no approval leaves false', () => {
    expect(hasHumanApprovalFor([], 'abc1234')).toBe(false);
  });

  it('standalone ✅ comment AFTER the proposal approves (comments as source of truth)', () => {
    expect(
      hasHumanApprovalFor(
        [aiC('proposal:abc1234 plan'), humanC('✅')],
        'abc1234',
      ),
    ).toBe(true);
  });

  it('standalone 👍 comment after the proposal approves', () => {
    expect(
      hasHumanApprovalFor(
        [aiC('QA Scenario Proposal proposal:abc1234'), humanC('👍')],
        'abc1234',
      ),
    ).toBe(true);
  });

  it('non-gating body emoji after proposal does NOT approve', () => {
    expect(
      hasHumanApprovalFor(
        [aiC('proposal:abc1234 plan'), humanC('🎉')],
        'abc1234',
      ),
    ).toBe(false);
  });

  it('emoji comment BEFORE the proposal does NOT approve it', () => {
    expect(
      hasHumanApprovalFor(
        [humanC('✅'), aiC('proposal:abc1234 plan')],
        'abc1234',
      ),
    ).toBe(false);
  });
});

describe('report status taxonomy', () => {
  it('has no BLOCKED in the taxonomy (AGENTS.md)', () => {
    expect(REPORT_STATUSES).not.toContain('BLOCKED');
  });

  it('renders a summary block', () => {
    const s = renderStatusSummary('Summary', [
      { target: 'AAO-1', status: 'APPLIED' },
      { target: 'AAO-2', status: 'SKIPPED', detail: 'no CI' },
    ]);
    expect(s).toContain('- APPLIED AAO-1');
    expect(s).toContain('- SKIPPED AAO-2 — no CI');
  });
});