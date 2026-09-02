/**
 * aialm-oss-adapter — self-aware custom fields (per-klient).
 *
 * Proprietary custom fields w projekcie klienta NOSZĄ krotkę STAGE/ROLE/AGENT.
 * Ten moduł jest PURE: nie zna żadnego konkretnego id pola (CID), pracuje na
 * nazwach — warstwa Jira resolve bez nazw na CID przy read/write.
 */
import {
  assertConsistent,
  DEFAULT_STATE,
  type AGENT,
  type ROLE,
  type STAGE,
  type TicketState,
} from '../shared/state.js';

/** Nazwy custom fields self-aware (AGENTS.md → Wdrożenie). */
export const SELF_AWARE_FIELDS = {
  stage: 'AIALM STAGE',
  role: 'AIALM ROLE',
  agent: 'AIALM AGENT',
} as const;

export type SelfAwareField = (typeof SELF_AWARE_FIELDS)[keyof typeof SELF_AWARE_FIELDS];

/** Surowa mapa nazwa-pole-custom (już rozwinięta z CID). */
export type FieldMap = Record<string, unknown>;

/** Dekoduj krotkę z surowej mapy pól (wartości: dowolny typ). Zawsze zwraca spójną krotkę. */
export function readStateFromFields(fields: FieldMap): TicketState {
  const raw = (name: string): string | undefined => {
    const v = fields[name];
    if (v == null) return undefined;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'object' && v !== null) {
      const candidate = (v as { value?: unknown }).value;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return undefined;
  };

  const stage = raw(SELF_AWARE_FIELDS.stage) as STAGE | undefined;
  const role = raw(SELF_AWARE_FIELDS.role) as ROLE | undefined;
  const agent = raw(SELF_AWARE_FIELDS.agent) as AGENT | undefined;

  const state: TicketState = {
    stage: stage ?? DEFAULT_STATE.stage,
    role: role ?? null,
    agent: agent ?? 'none',
  };
  const errs = assertConsistent(state);
  if (errs.length === 0) return state;
  // Niespójna krotka na tickecie → wracamy do domyślnej (IDLE) i zgłaszamy.
  return { ...DEFAULT_STATE };
}

/** Surowe wartości pól do wysłania w update (CID mapowane w warstwie Jira). */
export function fieldsFromState(state: TicketState): { stage?: string; role?: string; agent?: string } {
  return {
    stage: state.stage,
    ...(state.role ? { role: state.role } : {}),
    agent: state.agent,
  };
}

/** Czy krotka różni się od domyślnej (IDLE / brak roli / none). */
export function isDefaultState(state: TicketState): boolean {
  return state.stage === DEFAULT_STATE.stage && state.role === null && state.agent === 'none';
}