import { describe, expect, it } from 'vitest';
import {
  BOARD_STATUS,
  ROLE_COLUMNS,
  PROVISION_STATUSES,
  boardColumnFor,
  postApplyColumn,
  statusCategoryFor,
} from '../../src/aialm/oss/alm/board.ts';

describe('board contract — ROLE_COLUMNS', () => {
  it('orders the 18 columns Candidates Pool → agents/awaiting → impl/verify/pr → Done', () => {
    expect(ROLE_COLUMNS).toEqual([
      'Candidates Pool',
      'Agent Working (PO Analyst)',
      'Awaiting Approval (PO)',
      'Agent Working (PO Prep Decomp)',
      'Awaiting Approval (PO Decomp)',
      'Agent Working (QA Analyst)',
      'Awaiting Approval (QA)',
      'Agent Working (ARCH Analyst)',
      'Awaiting Approval (ARCH)',
      'Agent Working (SEC Analyst)',
      'Awaiting Approval (SEC)',
      'Agent Working (DEV Analyst)',
      'Awaiting Approval (DEV)',
      'Agent Working (QA Impl)',
      'Agent Working (DEV Impl)',
      'Agent Working (Verify)',
      'Agent Working (PR)',
      'Done',
    ]);
  });

  it('places Done last and uses only BOARD_STATUS values', () => {
    expect(ROLE_COLUMNS[ROLE_COLUMNS.length - 1]).toBe(BOARD_STATUS.done);
    for (const c of ROLE_COLUMNS) expect(Object.values(BOARD_STATUS)).toContain(c);
  });

  it('PROVISION_STATUSES = 17 role statuses (excludes default Done) with categories', () => {
    expect(PROVISION_STATUSES).toHaveLength(17);
    expect(PROVISION_STATUSES.some(s => s.name === BOARD_STATUS.done)).toBe(false);
    for (const { name, statusCategory } of PROVISION_STATUSES) {
      expect(statusCategory).toBe(statusCategoryFor(name));
      expect(['TODO', 'IN_PROGRESS', 'DONE']).toContain(statusCategory);
    }
  });

  it("patterns 'Agent Working (' as IN_PROGRESS and awaiting/candidates as TODO", () => {
    expect(statusCategoryFor('Candidates Pool')).toBe('TODO');
    expect(statusCategoryFor('Awaiting Approval (PO)')).toBe('TODO');
    expect(statusCategoryFor('Agent Working (QA Analyst)')).toBe('IN_PROGRESS');
    expect(statusCategoryFor('Agent Working (PR)')).toBe('IN_PROGRESS');
    expect(statusCategoryFor('Done')).toBe('DONE');
  });
});

describe('board column resolution', () => {
  it('maps a GENERATE skill to its Agent Working column', () => {
    expect(boardColumnFor({ kind: 'GENERATE', skill: 'aialm-oss-qa-analyze' })).toBe(BOARD_STATUS.qaAgent);
    expect(boardColumnFor({ kind: 'GENERATE', skill: 'aialm-oss-pr' })).toBe(BOARD_STATUS.pr);
    expect(boardColumnFor({ kind: 'GENERATE', skill: 'aialm-oss-dev-analyst' })).toBe(BOARD_STATUS.devAgent);
  });

  it('maps the candidate-selection WAIT to Candidates Pool and other waits to Awaiting Approval (PO)', () => {
    expect(boardColumnFor({ kind: 'WAIT', reason: 'awaiting candidate-selection approval (APPROVE/✅)' })).toBe(BOARD_STATUS.candidates);
    expect(boardColumnFor({ kind: 'WAIT', reason: 'po proposals present, await approval' })).toBe(BOARD_STATUS.poAwait);
    expect(boardColumnFor({ kind: 'WAIT' })).toBe(BOARD_STATUS.poAwait);
  });

  it('maps APPLY mutators to their post-apply column', () => {
    expect(boardColumnFor({ kind: 'APPLY', mutator: 'import' })).toBe(BOARD_STATUS.candidates);
    expect(boardColumnFor({ kind: 'APPLY', mutator: 'decompose' })).toBe(BOARD_STATUS.decompAwait);
    expect(boardColumnFor({ kind: 'APPLY', mutator: 'sec-apply' })).toBe(BOARD_STATUS.secAwait);
    expect(boardColumnFor({ kind: 'APPLY', mutator: 'arch-apply' })).toBe(BOARD_STATUS.archAwait);
  });

  it('POST_SELECTION lands in Agent Working (PO Analyst)', () => {
    expect(boardColumnFor({ kind: 'POST_SELECTION' })).toBe(BOARD_STATUS.poAgent);
  });

  it('postApplyColumn maps qa-apply/dev-apply to their impl columns and defaults to Verify', () => {
    expect(postApplyColumn('qa-apply')).toBe(BOARD_STATUS.qaImpl);
    expect(postApplyColumn('dev-apply')).toBe(BOARD_STATUS.devImpl);
    expect(postApplyColumn('unknown')).toBe(BOARD_STATUS.verify);
  });
});
