import { describe, expect, it } from 'vitest';
import {
  accessGrantComment,
  classifyComment,
  dispositionFor,
  feedbackRecord,
  feedbackRecordComment,
  feedbackRef,
  isRecorded,
  needsApproval,
} from '../../src/aialm/oss/feedback/feedback.ts';
import { adfToPlainText } from '../../src/aialm/oss/alm/jira.ts';

describe('classifyComment', () => {
  it('maps keywords to categories', () => {
    expect(classifyComment('this is a bug, it crashes')).toBe('BUG');
    expect(classifyComment('please add a test for this')).toBe('MISSING_TEST');
    expect(classifyComment('this is a scope change, we also need X')).toBe('SCOPE_CHANGE');
    expect(classifyComment('this is a blocker, cannot merge')).toBe('BLOCKER');
    expect(classifyComment('style: please rename this')).toBe('STYLE');
    expect(classifyComment('the architecture should separate layers')).toBe('ARCHITECTURE');
    expect(classifyComment('could you explain why?')).toBe('CLARIFICATION');
    expect(classifyComment('random note')).toBe('CLARIFICATION');
  });
});

describe('dispositionFor / needsApproval', () => {
  it('requires approval only for SCOPE_CHANGE and BLOCKER', () => {
    expect(dispositionFor('SCOPE_CHANGE').needsApproval).toBe(true);
    expect(dispositionFor('BLOCKER').needsApproval).toBe(true);
    expect(dispositionFor('BUG').needsApproval).toBe(false);
    expect(dispositionFor('MISSING_TEST').needsApproval).toBe(false);
    expect(dispositionFor('ARCHITECTURE').needsApproval).toBe(false);
    expect(dispositionFor('CLARIFICATION').needsApproval).toBe(false);
    expect(dispositionFor('STYLE').needsApproval).toBe(false);
  });

  it('routes ARCHITECTURE to a dev-analyst rerun and BUG to existing AC', () => {
    expect(dispositionFor('ARCHITECTURE').action).toContain('dev-analyst');
    expect(dispositionFor('BUG').action).toContain('existing AC');
  });
});

describe('feedbackRef / isRecorded (idempotency)', () => {
  it('builds a stable normalized ref and detects prior records', () => {
    const ref = feedbackRef('acme/widgets', 7, '123');
    expect(ref).toBe('acme/widgets#7/comment-123');
    expect(isRecorded([], ref)).toBe(false);
    expect(isRecorded([`feedback: ${ref}`], ref)).toBe(true);
  });
});

describe('feedbackRecord', () => {
  it('builds the maintainer FeedbackRecord shape', () => {
    const r = feedbackRecord({ category: 'SCOPE_CHANGE', ref: 'acme/widgets#7/comment-123', disposition: 'delta' });
    expect(r.source).toBe('maintainer');
    expect(r.category).toBe('SCOPE_CHANGE');
    expect(r.rawRef).toBe('acme/widgets#7/comment-123');
    expect(r.disposition).toBe('delta');
  });
});

describe('feedbackRecordComment / accessGrantComment', () => {
  it('embeds classification + planned action + approval badge', () => {
    const t = adfToPlainText(feedbackRecordComment({ ref: 'acme/widgets#7/comment-123', category: 'SCOPE_CHANGE', action: 'delta → approval', needsApproval: true }));
    expect(t).toContain('Feedback Record');
    expect(t).toContain('feedback: acme/widgets#7/comment-123');
    expect(t).toContain('category: SCOPE_CHANGE');
    expect(t).toContain('needs approval: YES');
    expect(t).toContain('no requirement is silently rewritten');
  });

  it('proposes a Viewer AccessGrant through the human gate', () => {
    const t = adfToPlainText(accessGrantComment({ who: 'm@x.com', projectKey: 'WIDG' }));
    expect(t).toContain('Access Grant proposal');
    expect(t).toContain('invite: m@x.com');
    expect(t).toContain('role: Viewer');
    expect(t).toContain('APPROVE to grant read-only visibility');
  });
});
