import { describe, expect, it } from 'vitest';
import { normalize, proposalHeader, proposalIdFor } from '../../src/aialm/oss/shared/identity.ts';

describe('proposalIdFor', () => {
  it('is deterministic and whitespace/case-insensitive', () => {
    const a = proposalIdFor('Scenario: Login works');
    const b = proposalIdFor('scenario:   login\nworks ');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{7}$/);
  });

  it('differs for different payloads', () => {
    expect(proposalIdFor('a')).not.toBe(proposalIdFor('b'));
  });

  it('pads to 7 chars even for tiny hash space collisions', () => {
    // format contract: exactly 7 hex chars
    for (let i = 0; i < 20; i++) {
      expect(proposalIdFor(`payload-${i}`)).toMatch(/^[0-9a-f]{7}$/);
    }
  });

  it('header form matches aialm-oss contract', () => {
    expect(proposalHeader('AIALMOSS-42', 'aialm-oss-po-analyze', '0ab12cd')).toBe(
      '[AI-generated] Proposal — AIALMOSS-42 — aialm-oss-po-analyze:0ab12cd',
    );
  });

  it('normalize decodes entities before hashing', () => {
    expect(normalize('&lt;b&gt; &amp; x')).toBe('<b> & x');
  });
});
