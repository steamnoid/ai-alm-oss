import { describe, it, expect } from 'vitest';
import {
  assertConsistent,
  applyState,
  isConsistent,
  isLegalTransition,
  DEFAULT_STATE,
  IMMUTABLE_STATUS_LABEL_PREFIX,
  stateLabels,
  statusLabel,
} from '../../src/aialm/oss/shared/state.js';
import { fillPickup, pickupFor, GATE_PICKUP } from '../../src/aialm/oss/shared/pickup.js';

describe('status labels', () => {
  it('derives namespaced label from uppercase underscore value', () => {
    expect(statusLabel('stage', 'AWAITING_AGENT_PICKUP')).toBe('aialm:stage:awaiting-agent-pickup');
    expect(statusLabel('role', 'PO')).toBe('aialm:role:po');
    expect(IMMUTABLE_STATUS_LABEL_PREFIX).toBe('aialm:');
  });

  it('stateLabels include stage always, role only when present', () => {
    expect(stateLabels({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'PO' })).toEqual([
      'aialm:stage:awaiting-human-approval',
      'aialm:role:po',
    ]);
    expect(stateLabels({ stage: 'DONE', role: null })).toEqual(['aialm:stage:done']);
  });
});

describe('state machine invariants', () => {
  it('DEFAULT_STATE is consistent (IDLE/none notre role)', () => {
    expect(isConsistent({ ...DEFAULT_STATE })).toBe(true);
    expect(assertConsistent(DEFAULT_STATE)).toEqual([]);
  });

  it('AGENT=none ⇔ STAGE in {IDLE,AWAITING_HUMAN_APPROVAL,READY,DONE}', () => {
    expect(isConsistent({ stage: 'IDLE', role: null, agent: 'none' })).toBe(true);
    expect(isConsistent({ stage: 'READY', role: null, agent: 'none' })).toBe(true);
    expect(isConsistent({ stage: 'DONE', role: null, agent: 'none' })).toBe(true);
    expect(isConsistent({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'PO', agent: 'none' })).toBe(true);

    // AGENT=none z aktywnym etapem → niespójne.
    expect(isConsistent({ stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent: 'none' })).toBe(false);
    expect(isConsistent({ stage: 'IN_PROGRESS_BY_AGENT', role: 'PO', agent: 'none' })).toBe(false);
  });

  it('AGENT≠none ⇔ STAGE in {AWAITING_AGENT_PICKUP,IN_PROGRESS_BY_AGENT}', () => {
    const agent = 'aialm-oss-po-analyze';
    expect(isConsistent({ stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent })).toBe(true);
    expect(isConsistent({ stage: 'IN_PROGRESS_BY_AGENT', role: 'PO', agent })).toBe(true);

    // AGENT≠none z etapem bez agenta → niespójne.
    expect(isConsistent({ stage: 'IDLE', role: null, agent })).toBe(false);
    expect(isConsistent({ stage: 'DONE', role: null, agent })).toBe(false);
    expect(isConsistent({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'PO', agent })).toBe(false);
  });

  it('AWAITING_HUMAN_APPROVAL requires a role; DONE rejects a role', () => {
    expect(isConsistent({ stage: 'AWAITING_HUMAN_APPROVAL', role: null, agent: 'none' })).toBe(false);
    expect(isConsistent({ stage: 'DONE', role: 'PO', agent: 'none' })).toBe(false);
  });

  it('ROLE=AI is transient: READY/AWAITING_HUMAN_APPROVAL + none consistent, with agent inconsistent', () => {
    expect(isConsistent({ stage: 'READY', role: 'AI', agent: 'none' })).toBe(true);
    expect(isConsistent({ stage: 'AWAITING_HUMAN_APPROVAL', role: 'AI', agent: 'none' })).toBe(true);
    expect(stateLabels({ stage: 'READY', role: 'AI' })).toEqual(['aialm:stage:ready', 'aialm:role:ai']);
    expect(statusLabel('role', 'AI')).toBe('aialm:role:ai');
    // AI must not persist alongside an active agent
    expect(isConsistent({ stage: 'AWAITING_AGENT_PICKUP', role: 'AI', agent: 'aialm-oss-po-analyze' })).toBe(false);
    expect(isConsistent({ stage: 'IN_PROGRESS_BY_AGENT', role: 'AI', agent: 'aialm-oss-po-analyze' })).toBe(false);
  });

  it('rejects unknown STAGE/ROLE/AGENT', () => {
    expect(isConsistent({ stage: 'BLOCKED', role: null, agent: 'none' } as never)).toBe(false);
    expect(isConsistent({ stage: 'IDLE', role: 'OPS', agent: 'none' } as never)).toBe(false);
    expect(isConsistent({ stage: 'IDLE', role: null, agent: 'ghost-agent' } as never)).toBe(false);
  });
});

describe('transition table', () => {
  const legal: Array<[string, string]> = [
    ['IDLE', 'AWAITING_AGENT_PICKUP'],
    ['READY', 'AWAITING_AGENT_PICKUP'],
    ['AWAITING_AGENT_PICKUP', 'IN_PROGRESS_BY_AGENT'],
    ['IN_PROGRESS_BY_AGENT', 'AWAITING_HUMAN_APPROVAL'],
    ['IN_PROGRESS_BY_AGENT', 'AWAITING_AGENT_PICKUP'],
    ['AWAITING_HUMAN_APPROVAL', 'AWAITING_AGENT_PICKUP'],
    ['AWAITING_HUMAN_APPROVAL', 'DONE'],
  ];
  it.each(legal)('%s → %s is legal', (from, to) => {
    expect(isLegalTransition(from as never, to as never)).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(isLegalTransition('DONE', 'IDLE')).toBe(false);
    expect(isLegalTransition('AWAITING_AGENT_PICKUP', 'DONE')).toBe(false);
    expect(isLegalTransition('IN_PROGRESS_BY_AGENT', 'READY')).toBe(false);
    expect(isLegalTransition('IDLE', 'DONE')).toBe(false);
  });

  it('applyState applies a consistent transition and returns a fresh copy', () => {
    const from = { stage: 'AWAITING_HUMAN_APPROVAL' as const, role: 'PO' as const, agent: 'none' as const };
    const to = { stage: 'AWAITING_AGENT_PICKUP' as const, role: 'PO' as const, agent: 'aialm-oss-po-analyze' as const };
    const next = applyState(from, to);
    expect(next).toEqual(to);
    expect(next).not.toBe(to);
  });

  it('applyState throws on illegal or inconsistent target', () => {
    const from = { stage: 'DONE' as const, role: null, agent: 'none' as const };
    expect(() => applyState(from, { stage: 'IDLE', role: null, agent: 'none' })).toThrow(/illegal transition/);
    const in_ = { stage: 'AWAITING_HUMAN_APPROVAL' as const, role: 'PO' as const, agent: 'none' as const };
    expect(() => applyState(in_, { stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent: 'none' })).toThrow(/inconsistent/);
  });
});

describe('pickup convention', () => {
  it('discover approved → aialm-oss-po-analyze / PO / AWAITING_AGENT_PICKUP', () => {
    const s = fillPickup('DISCOVER_APPROVED');
    expect(s).toEqual({ stage: 'AWAITING_AGENT_PICKUP', role: 'PO', agent: 'aialm-oss-po-analyze' });
    expect(GATE_PICKUP.DISCOVER_APPROVED).toEqual(pickupFor('DISCOVER_APPROVED'));
  });

  it('contract approved → aialm-oss-dev-impl (sekwencja impl)', () => {
    expect(fillPickup('CONTRACT_APPROVED').agent).toBe('aialm-oss-dev-impl');
    expect(fillPickup('CONTRACT_APPROVED').role).toBe('DEV');
  });

  it('dev-impl done → qa-impl przed verify', () => {
    expect(fillPickup('DEV_IMPL_DONE').agent).toBe('aialm-oss-qa-impl');
    expect(fillPickup('QA_IMPL_DONE').agent).toBe('aialm-oss-verify');
    expect(fillPickup('VERIFY_READY').agent).toBe('aialm-oss-pr');
  });

  it('ac approved → decompose zawsze w ścieżce (po-prep-decompose)', () => {
    expect(fillPickup('AC_APPROVED').agent).toBe('aialm-oss-po-prep-decompose');
  });

  it('every pickup satisfies the AGENT≠none invariant', () => {
    for (const gate of Object.keys(GATE_PICKUP) as Array<keyof typeof GATE_PICKUP>) {
      expect(isConsistent(fillPickup(gate))).toBe(true);
    }
  });
});