import { describe, expect, it } from 'vitest';
import { assertAiCommentSafe, hasApprovalShape, isAiMarked } from '../../src/aialm/oss/shared/ai-comment.ts';

describe('ai-comment guard', () => {
  it('flags marked comments as AI', () => {
    expect(isAiMarked('[AI-generated] Proposal')).toBe(true);
    expect(isAiMarked('looks good')).toBe(false);
  });

  it('detects approval-shaped content', () => {
    expect(hasApprovalShape('APPROVE:8d1e8e8')).toBe(true);
    expect(hasApprovalShape('🗑️:8d1e8e8')).toBe(true);
    expect(hasApprovalShape('✅')).toBe(true);
    expect(hasApprovalShape('please review the proposal')).toBe(false);
  });

  it('rejects an unmarked approval-shaped comment (would read as human approval)', () => {
    expect(() => assertAiCommentSafe('APPROVE:8d1e8e8')).toThrow(/self-approval/);
    expect(() => assertAiCommentSafe('✅')).toThrow(/self-approval/);
  });

  it('allows a properly marked AI comment', () => {
    expect(() => assertAiCommentSafe('[AI-generated] Proposal — KEY — aialm-oss-po-analyze:8d1e8e8')).not.toThrow();
    expect(() => assertAiCommentSafe('[AI-generated] summary')).not.toThrow();
  });
});
