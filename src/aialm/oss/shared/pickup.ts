/**
 * aialm-oss-shared — pickup convention (AGENTS.md).
 *
 * Człowiek ustawia WYŁĄCZNIE STAGE=AWAITING_AGENT_PICKUP. ROLE + AGENT
 * wypełnia konwencja wg tablicy "Po bramce → AGENT" — inaczej krotka łamie
 * invariant AGENT≠none ⇔ {AWAITING_AGENT_PICKUP, IN_PROGRESS_BY_AGENT}.
 */
import type { AGENT, ROLE, STAGE, TicketState } from './state.js';

/** Bramka (gate) po której strona jest wyzwalana. */
export type Gate =
  | 'DISCOVER_APPROVED'
  | 'AC_APPROVED'
  | 'DECOMPOSE_DONE'
  | 'QA_APPROVED'
  | 'ARCH_APPROVED'
  | 'SEC_APPROVED'
  | 'CONTRACT_APPROVED'
  | 'DEV_IMPL_DONE'
  | 'QA_IMPL_DONE'
  | 'VERIFY_READY';

export interface Pickup {
  role: ROLE;
  agent: AGENT;
  nextStage: STAGE;
}

/** Konwencja bramek → pickup (AGENTS.md). */
export const GATE_PICKUP: Record<Gate, Pickup> = {
  DISCOVER_APPROVED: { role: 'PO', agent: 'aialm-oss-po-analyze', nextStage: 'AWAITING_AGENT_PICKUP' },
  AC_APPROVED: { role: 'PO', agent: 'aialm-oss-po-prep-decompose', nextStage: 'AWAITING_AGENT_PICKUP' },
  DECOMPOSE_DONE: { role: 'QA', agent: 'aialm-oss-qa-analyze', nextStage: 'AWAITING_AGENT_PICKUP' },
  QA_APPROVED: { role: 'ARCH', agent: 'aialm-oss-arch-analyze', nextStage: 'AWAITING_AGENT_PICKUP' },
  ARCH_APPROVED: { role: 'SEC', agent: 'aialm-oss-sec-analyze', nextStage: 'AWAITING_AGENT_PICKUP' },
  SEC_APPROVED: { role: 'DEV', agent: 'aialm-oss-dev-analyst', nextStage: 'AWAITING_AGENT_PICKUP' },
  CONTRACT_APPROVED: { role: 'DEV', agent: 'aialm-oss-dev-impl', nextStage: 'AWAITING_AGENT_PICKUP' },
  DEV_IMPL_DONE: { role: 'QA', agent: 'aialm-oss-qa-impl', nextStage: 'AWAITING_AGENT_PICKUP' },
  QA_IMPL_DONE: { role: 'DEV', agent: 'aialm-oss-verify', nextStage: 'AWAITING_AGENT_PICKUP' },
  VERIFY_READY: { role: 'DEV', agent: 'aialm-oss-pr', nextStage: 'AWAITING_AGENT_PICKUP' },
};

/**
 * Buduje krotkę pickup dla danej bramki: STAGE=AWAITING_AGENT_PICKUP,
 * ROLE/AGENT z konwencji. Gwarantuje spójność invariantu (AGENT≠none).
 */
export function fillPickup(gate: Gate): TicketState {
  const p = GATE_PICKUP[gate];
  return { stage: 'AWAITING_AGENT_PICKUP', role: p.role, agent: p.agent };
}

/** Rolę i agenta dla pickup określonej bramki (deklaratywna wartość). */
export function pickupFor(gate: Gate): Pickup {
  return { ...GATE_PICKUP[gate] };
}