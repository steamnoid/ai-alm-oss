/**
 * aialm-oss-shared — self-aware ticket state machine (AGENTS.md).
 *
 * Status ticketa to krotka 3 niezależnych wymiarów: STAGE / ROLE / AGENT.
 * Ten moduł jest PURE (zero I/O): definiuje enumy, invarianty spójności
 * oraz deklaratywną tablicę legalnych przejść. Jest source of truth dla
 * każego skilla — implementacja nie może wymyślać własnych stanów.
 */

export const STAGES = [
  'IDLE',
  'AWAITING_HUMAN_APPROVAL',
  'AWAITING_AGENT_PICKUP',
  'IN_PROGRESS_BY_AGENT',
  'READY',
  'DONE',
] as const;

export type STAGE = (typeof STAGES)[number];

/** ROLE są skalarne: jeden aktywny opiekun w danym momencie. */
export const ROLES = ['PO', 'DEV', 'QA', 'SEC', 'ARCH'] as const;
export type ROLE = (typeof ROLES)[number];

/**
 * AGENT = `none` lub konkretny skill aialm-oss-*. Lista odzwierciedla
 * pętlę kanoniczną (onboard…feedback). Dokładne wartości NIE wolno zmieniać
 * bez zgody człowieka (AGENTS.md).
 */
export const AGENTS = [
  'none',
  'aialm-oss-project-onboard',
  'aialm-oss-discover',
  'aialm-oss-po-analyze',
  'aialm-oss-po-update-approved',
  'aialm-oss-po-prep-decompose',
  'aialm-oss-po-decompose',
  'aialm-oss-qa-analyze',
  'aialm-oss-qa-update-approved',
  'aialm-oss-arch-analyze',
  'aialm-oss-arch-update-approved',
  'aialm-oss-sec-analyze',
  'aialm-oss-sec-update-approved',
  'aialm-oss-dev-analyst',
  'aialm-oss-dev-update-approved',
  'aialm-oss-dev-impl',
  'aialm-oss-qa-impl',
  'aialm-oss-verify',
  'aialm-oss-pr',
  'aialm-oss-feedback',
  'aialm-oss-e2e-consistency',
] as const;

export type AGENT = (typeof AGENTS)[number];

/** Krotka stanu: konglomerat 3 wymiarów. */
export interface TicketState {
  stage: STAGE;
  role: ROLE | null;
  agent: AGENT;
}

/** Wartość domyślna nowego ticketa (AGENTS.md → IDLE / _ / none; ROLE pusty). */
export const DEFAULT_STATE: Readonly<TicketState> = {
  stage: 'IDLE',
  role: null,
  agent: 'none',
};

const ACTIVE_AGENT_STAGES: readonly STAGE[] = ['AWAITING_AGENT_PICKUP', 'IN_PROGRESS_BY_AGENT'];
const NO_AGENT_STAGES: readonly STAGE[] = ['IDLE', 'AWAITING_HUMAN_APPROVAL', 'READY', 'DONE'];

/** Invariant: AGENT=none ⇔ STAGE ∈ {IDLE, AWAITING_HUMAN_APPROVAL, READY, DONE}. */
export function isAgentNone(state: Pick<TicketState, 'stage' | 'agent'>): boolean {
  return state.agent === 'none';
}

/** Sprawdza deterministyczne invarianty spójności krotki. */
export function assertConsistent(state: TicketState): string[] {
  const errors: string[] = [];

  if (!(STAGES as readonly string[]).includes(state.stage)) {
    errors.push(`unknown STAGE: ${String(state.stage)}`);
  }
  if (state.role !== null && !(ROLES as readonly string[]).includes(state.role)) {
    errors.push(`unknown ROLE: ${String(state.role)}`);
  }
  if (!(AGENTS as readonly string[]).includes(state.agent)) {
    errors.push(`unknown AGENT: ${String(state.agent)}`);
  }

  if (state.agent === 'none') {
    if (!(NO_AGENT_STAGES as readonly string[]).includes(state.stage)) {
      errors.push(`AGENT=none but STAGE=${state.stage} requires an agent`);
    }
  } else {
    if (!(ACTIVE_AGENT_STAGES as readonly string[]).includes(state.stage)) {
      errors.push(`AGENT=${state.agent} but STAGE=${state.stage} must be active-agent`);
    }
  }

  // ROLE definiuje "którego człowieka" tylko przy AWAITING_HUMAN_APPROVAL.
  if (state.stage === 'AWAITING_HUMAN_APPROVAL' && state.role === null) {
    errors.push('AWAITING_HUMAN_APPROVAL requires a role');
  }
  // DONE bez aktywnego opiekuna (role opuszcza).
  if (state.stage === 'DONE' && state.role !== null) {
    errors.push('DONE must have no active role');
  }

  return errors;
}

export function isConsistent(state: TicketState): boolean {
  return assertConsistent(state).length === 0;
}

/**
 * Deklaratywna tabela legalnych przejść (AGENTS.md transition table).
 * "kto wyzwala" jest opisane w komentarzu — przejście samo w sobie jest
 * wektorem (od, do); dopuszczalność aktora waliduje się osobno (exclusive
 * mutator w adapterze/skillu).
 */
export interface Transition {
  from: STAGE;
  to: STAGE;
  // AGENT/ROLE wyjściowe (if set) i docelowe (if set) — transycja sprawdza,
  // czy zmiana krotki jest spójna.
}

const LEGAL_TRANSITIONS: readonly Transition[] = [
  { from: 'IDLE', to: 'AWAITING_AGENT_PICKUP' },
  { from: 'READY', to: 'AWAITING_AGENT_PICKUP' },
  { from: 'AWAITING_AGENT_PICKUP', to: 'IN_PROGRESS_BY_AGENT' },
  { from: 'IN_PROGRESS_BY_AGENT', to: 'AWAITING_HUMAN_APPROVAL' },
  { from: 'IN_PROGRESS_BY_AGENT', to: 'AWAITING_AGENT_PICKUP' },
  { from: 'AWAITING_HUMAN_APPROVAL', to: 'AWAITING_AGENT_PICKUP' },
  { from: 'AWAITING_HUMAN_APPROVAL', to: 'DONE' },
];

/** Czy przejście STAGE (from → to) jest legalne wg tabeli przejść. */
export function isLegalTransition(from: STAGE, to: STAGE): boolean {
  return LEGAL_TRANSITIONS.some(t => t.from === from && t.to === to);
}

/**
 * Pure apply: przyjmuje wynikową krotkę (po ręcznie zarządzonym przejściu)
 * i waliduje, czy całość jest spójna + przejście STAGE legalne. Nie dotyka
 * I/O — zwraca nowy obiekt lub rzuca.
 */
/**
 * Auto-labelizoobwane stany. Labele są GLOBALNE w Jira, więc izolujemy własne
 * labela prefiksem `aialm:`. Wartość po prefiksie to dokładna (znormalizowana
 * do małych liter) wartość wymiaru — dzięki temu label wiernie odzwierciedla
 * custom field i jest bezpiecznie usuwalny (jesteśmy jedynymi właścicielami
 * prefiksu).
 */
export const IMMUTABLE_STATUS_LABEL_PREFIX = 'aialm:';

/** Zwraca label reprezentujący wartość wymiaru (np. STAGE → `aialm:stage:awaiting-human-approval`). */
export function statusLabel(dimension: 'stage' | 'role', value: string): string {
  return `${IMMUTABLE_STATUS_LABEL_PREFIX}${dimension}:${value
    .toLowerCase()
    .replaceAll(' ', '-')
    .replaceAll('_', '-')}`;
}

/**
 * Pełny zestaw labeli, które POWINNY być na tickecie dla danej krotki.
 * STAGE jest zawsze obecny; ROLE tylko gdy niepusty (przy DONE role znika).
 * AGENT celowo NIE jest labelem (zbyt wysoka kardynalność + `none`).
 */
export function stateLabels(state: Pick<TicketState, 'stage' | 'role'>): string[] {
  const labels = [statusLabel('stage', state.stage)];
  if (state.role !== null) labels.push(statusLabel('role', state.role));
  return labels;
}

export function applyState(current: TicketState, next: TicketState): TicketState {
  if (current.stage !== next.stage && !isLegalTransition(current.stage, next.stage)) {
    throw new Error(`illegal transition: ${current.stage} → ${next.stage}`);
  }
  const errors = assertConsistent(next);
  if (errors.length > 0) {
    throw new Error(`inconsistent state: ${errors.join('; ')}`);
  }
  return { ...next };
}