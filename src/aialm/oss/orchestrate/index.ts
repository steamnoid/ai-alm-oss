/**
 * aialm-oss-orchestrate — single-pass gate-advance (ograniczony zakres, argument-based).
 *
 * Bramka DISCOVER_APPROVED (kandydat discover zatwierdzony, w Backlogu):
 *   wejście  (WSZYSTKIE): native status = Backlog  AND
 *                         STAGE=READY / ROLE=AI / AGENT=none  AND
 *                         ludzkie zatwierdzenie kandydata (hasCandidateApproval)
 *   wyjście:            STAGE=AWAITING_AGENT_PICKUP / ROLE=null / AGENT=aialm-oss-po-analyze
 *                         + native status AWAITS AGENT PICKUP + usunięcie labela `candidate`
 *                         (atomowo: krotka + natywny status/kanban)
 *
 * Źródło prawdy = custom fields (AIALM STAGE/ROLE/AGENT). Labele aialm:*
 * to TYLKO sync z pól (stateLabels/syncStateLabels) — NIGDY odwrotnie.
 * ROLE=AI to transient handoff: człowiek ustawia AI w AIALM ROLE by oddać pracę
 * orchestratorowi; po pickup ROLE wraca do null (invariant ROLE tylko przy
 * AWAITING_HUMAN_APPROVAL, a przy AWAITING_AGENT_PICKUP ROLE=null).
 * Orchestrator atomowo syncuje krotkę i natywny status kanban wg mapy STAGE→status
 * (Backlog/AWAITS AGENT PICKUP/AGENT WORKING/AWAITS HUMAN APPROVAL/Done).
 */
import type { JiraClient } from '../adapter/jira.js';
import type { SelfAwareCids } from '../adapter/fields-config.js';
import { readStateFromFields, SELF_AWARE_FIELDS } from '../adapter/fields.js';
import { hasCandidateApproval, hasHumanApprovalFor, type CommentLike } from '../shared/approval.js';
import type { AGENT, STAGE, TicketState } from '../shared/state.js';
import { isDebugOn } from '../shared/state.js';
import { markdownToAdf } from '../adapter/adf.js';

/**
 * Map CID-keyed fields (from getIssue with CID queries) to name-keyed fields
 * (for readStateFromFields). Also preserves non-self-aware fields like 'status'.
 */
function byName(fields: Record<string, unknown>, cids: SelfAwareCids): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (cids.stage) out[SELF_AWARE_FIELDS.stage] = fields[cids.stage];
  if (cids.role) out[SELF_AWARE_FIELDS.role] = fields[cids.role];
  if (cids.agent) out[SELF_AWARE_FIELDS.agent] = fields[cids.agent];
  // Preserve native fields (status, labels, etc.)
  for (const [k, v] of Object.entries(fields)) {
    if (!Object.values(cids).includes(k)) out[k] = v;
  }
  return out;
}

export type AdvanceResult =
  | 'PICKUP_OK'
  | 'NO_APPROVAL'
  | 'OUT_OF_SCOPE'
  | 'NOT_CANDIDATE'
  | 'ERROR';

export interface AdvanceRow {
  key: string;
  result: AdvanceResult;
  status: string;
  state: string;
  detail?: string;
}

/** Bramka: kandydat discover — AWAITING_HUMAN_APPROVAL lub READY (oba „gotowy do pickupu”). */
const SCOPE_STAGES: readonly STAGE[] = ['READY', 'AWAITING_HUMAN_APPROVAL'];
/** AGENT picku dla discover-kandydata (konwencja → po-analyze; ROLE emissji=null). */
const PICKUP_AGENT: AGENT = 'aialm-oss-po-analyze';
/** Native stan, w którym tickecik musi przebywać (Backlog). */
const BACKLOG_STATUS = 'backlog';
/** Native stan po pracy skilla (czeka na człowieka). */
const AWAITS_HUMAN_APPROVAL_STATUS = 'awaits human approval';

/** Pickup Konwencja (AGENTS.md tablica pickup) — linear routing post-human-approve. */
const PICKUP_AFTER_APPROVAL: ReadonlyArray<{ fromSkill: AGENT; toAgent: AGENT }> = [
  { fromSkill: 'aialm-oss-po-analyze', toAgent: 'aialm-oss-po-prep-decompose' },
  { fromSkill: 'aialm-oss-po-prep-decompose', toAgent: 'aialm-oss-po-decompose' },
  { fromSkill: 'aialm-oss-po-decompose', toAgent: 'aialm-oss-qa-analyze' },
  { fromSkill: 'aialm-oss-qa-analyze', toAgent: 'aialm-oss-arch-analyze' },
  { fromSkill: 'aialm-oss-arch-analyze', toAgent: 'aialm-oss-sec-analyze' },
  { fromSkill: 'aialm-oss-sec-analyze', toAgent: 'aialm-oss-dev-analyst' },
  { fromSkill: 'aialm-oss-dev-analyst', toAgent: 'aialm-oss-dev-impl' },
  { fromSkill: 'aialm-oss-dev-impl', toAgent: 'aialm-oss-qa-impl' },
  { fromSkill: 'aialm-oss-qa-impl', toAgent: 'aialm-oss-verify' },
  { fromSkill: 'aialm-oss-verify', toAgent: 'aialm-oss-pr' },
] as const;

function extractProposalIds(comments: readonly CommentLike[], skill: string): string[] {
  const ids: string[] = [];
  // proposalId to 7-12 hex chars (sha256 slice). Używaj hex-boundary, nie \w+, bo ADF glue może
  // skleić "...:872f6f02bbcapackageProposalId" — \w+ połknąłby suffix.
  const re = new RegExp(`${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([0-9a-f]{7,12})`, 'gi');
  for (const c of comments) {
    const body = c.body ?? '';
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) ids.push(m[1]!.toLowerCase());
  }
  return [...new Set(ids)];
}

function hasApprovedProposalForSkill(comments: readonly CommentLike[], skill: AGENT): boolean {
  const ids = extractProposalIds(comments, skill);
  if (ids.length === 0) return false;
  // Tylko konkretne zatwierdzenie proposal:<id> (reakcja lub APPROVE:<id>).
  // Generyczny hasCandidateApproval (samo ✅) NIE może tu decydować — inaczej
  // najwcześniejszy skill z propozycjami zawsze wygrywa i blokuje późniejsze
  // etapy (np. po-analyze ✅ blokował po-prep-decompose → po-decompose).
  return ids.some(id => hasHumanApprovalFor(comments, id));
}

function hasAnyProposalForSkill(comments: readonly CommentLike[], skill: AGENT): boolean {
  return extractProposalIds(comments, skill).length > 0;
}

/**
 * Wyprowadź następnego AGENTa po human-approve.
 * Sprawdza linearnie pickup table: pierwszy fromSkill z approved proposal wygrywa.
 * Dla WELLBEINGT-5 (po-analyze proposals + generyczny ✅) approved check musi
 * uwzględniać candidateApproval jako pokrycie skill-proposals (shared account).
 * Fallback discover gdy brak skill-proposals ale candidateApproved.
 */
export function nextAgentAfterApproval(state: TicketState, comments: readonly CommentLike[]): AGENT | null {
  // Pickup table — wybierz NAJDALEJ zaawansowany zatwierdzony etap (ostatni match),
  // nie najwcześniejszy. Dzięki temu po-analyze+po-prep-decompose oba approved → po-decompose.
  let lastMatch: AGENT | null = null;
  for (const row of PICKUP_AFTER_APPROVAL) {
    if (hasApprovedProposalForSkill(comments, row.fromSkill)) lastMatch = row.toAgent;
  }
  if (lastMatch) return lastMatch;
  // Fallback dla po-analyze gdy human dał tylko generyczne ✅ bez APPROVE:<id>
  // (shared-account dev: isAi-mark rozróżnia). Tylko dla pierwszego etapu.
  if (hasCandidateApproval(comments)) {
    if (hasAnyProposalForSkill(comments, 'aialm-oss-po-analyze')) {
      const poRow = PICKUP_AFTER_APPROVAL.find(r => r.fromSkill === 'aialm-oss-po-analyze');
      if (poRow) return poRow.toAgent;
    }
    // Discover fallback — tylko gdy brak jakichkolwiek propozycji (genuine discover kandydat)
    const hasAnyProposalAtAll = PICKUP_AFTER_APPROVAL.some(row => hasAnyProposalForSkill(comments, row.fromSkill));
    if (!hasAnyProposalAtAll && (state.stage === 'READY' || state.stage === 'AWAITING_HUMAN_APPROVAL')) return PICKUP_AGENT;
  }
  return null;
}

/** STAGE → natywny status kanban (name-based, odporne na ID). Jedno źródło prawdy dla kolumn. */
export const STAGE_NATIVE_STATUS: Record<STAGE, string> = {
  IDLE: 'Backlog',
  READY: 'Backlog',
  AWAITING_AGENT_PICKUP: 'AWAITS AGENT PICKUP',
  IN_PROGRESS_BY_AGENT: 'AGENT WORKING',
  AWAITING_HUMAN_APPROVAL: 'AWAITS HUMAN APPROVAL',
  DONE: 'Done',
};

export function stageNativeStatus(stage: STAGE): string {
  return STAGE_NATIVE_STATUS[stage];
}

/**
 * Ograniczony inferGate: STAGE∈{READY,AWAITING_HUMAN_APPROVAL}, ROLE=AI, AGENT=none
 * (odczyt z custom fields, nie z labeli — labele to pochodna pól). Inny kształt => false.
 * ROLE=AI to explicit handoff człowieka → orchestrator (replace PO; AI transient).
 */
export function inferGate(state: TicketState): boolean {
  return (SCOPE_STAGES as readonly string[]).includes(state.stage) && state.role === 'AI' && state.agent === 'none';
}

/** Czy kandydat ma ludzkie zatwierdzenie (semantyka discovery-gate). */
export function candidateApproved(comments: readonly CommentLike[]): boolean {
  return hasCandidateApproval(comments);
}

/** Czy native status ticketa to Backlog (case-insensitive). */
export function isInBacklog(fields: Record<string, unknown>): boolean {
  const status = (fields.status as { name?: string } | undefined)?.name;
  return status?.toLowerCase() === BACKLOG_STATUS;
}

/** Czy native status to AWAITS HUMAN APPROVAL (case-insensitive). */
export function isInAwaitingHumanApproval(fields: Record<string, unknown>): boolean {
  const status = (fields.status as { name?: string } | undefined)?.name;
  return status?.toLowerCase() === AWAITS_HUMAN_APPROVAL_STATUS;
}

/** Czy ticket jest w legalnym native statusie dla advance (Backlog lub AWAITS HUMAN APPROVAL). */
export function isInAdvanceSourceStatus(fields: Record<string, unknown>): boolean {
  return isInBacklog(fields) || isInAwaitingHumanApproval(fields);
}

/** Usuń label `candidate` (jeśli obecny), zachowując pozostałe obce labele. */
async function dropCandidateLabel(jira: JiraClient, key: string): Promise<void> {
  const labels = await jira.getLabels(key);
  if (!labels.includes('candidate')) return;
  await jira.setLabels(key, labels.filter(l => l !== 'candidate'));
}

function compactState(state: TicketState): string {
  return `${state.stage}/${state.role ?? '—'}/${state.agent}`;
}

function nativeStatus(fields: Record<string, unknown>): string {
  return ((fields.status as { name?: string } | undefined)?.name ?? '—');
}

/**
 * Jedno przejście dla jednego kandydata. Zwraca wiersz raportu —
 * ZAWSZE z `status` i zwartą `state` (krotka z custom fields), niezależnie od wyniku.
 * Orchestrator mutuje atomowo krotkę (custom fields + syncStateLabels) i natywny
 * status kanban (transition wg STAGE_NATIVE_STATUS).
 */
export async function advanceOne(
  jira: JiraClient,
  key: string,
  opts: { cids: SelfAwareCids },
): Promise<AdvanceRow> {
  try {
    const issue = (await jira.getIssue(key, [
      opts.cids.stage,
      opts.cids.role,
      opts.cids.agent,
      'status',
    ])) as { fields?: Record<string, unknown> };
    const fields = issue.fields ?? {};
    const state = readStateFromFields(byName(fields, opts.cids));
    const status = nativeStatus(fields);
    const stateStr = compactState(state);

    // Warunek wejścia: wygaszony przegląd — najpierw bramka krotki (discover i ogólny post-approve).
    // STAGE∈{READY,AWAITING_HUMAN_APPROVAL} + ROLE=AI + AGENT=none, źródło = Backlog lub AWAITS HUMAN APPROVAL.
    if (!inferGate(state)) {
      return {
        key,
        status,
        state: stateStr,
        result: 'NOT_CANDIDATE',
        detail: `poza bramką discover/post-approve: krotka ${stateStr} (oczekiwano READY lub AWAITING_HUMAN_APPROVAL / AI / none)`,
      };
    }
    if (!isInAdvanceSourceStatus(fields)) {
      return {
        key,
        status,
        state: stateStr,
        result: 'OUT_OF_SCOPE',
        detail: `status=${status} (wymagany Backlog lub AWAITS HUMAN APPROVAL)`,
      };
    }

    const comments = await jira.listComments(key);
    // Rozstrzygnij następnego agenta wg konwencji pickup (AGENTS.md tablica).
    // Jedno źródło: nextAgentAfterApproval bada linearnie pickup table (approved proposals)
    // i fallback discover. Odporne na READY vs AWAITING_HUMAN_APPROVAL podmiany.
    const nextAgent = nextAgentAfterApproval(state, comments);
    if (!nextAgent) {
      return {
        key,
        status,
        state: stateStr,
        result: 'NO_APPROVAL',
        detail:
          state.stage === 'READY'
            ? 'brak ludzkiego zatwierdzenia (✅) dla kandydata'
            : 'brak zatwierdzonej propozycji (✅/APPROVE:<id>) dla któregokolwiek etapu pickup',
      };
    }

    // Pickup: STAGE=AWAITING_AGENT_PICKUP, ROLE=null (AI handoff transient → null), AGENT=nextAgent.
    // Atomowo: krotka + natywny status kanban (AWAITS AGENT PICKUP).
    const target: TicketState = { stage: 'AWAITING_AGENT_PICKUP', role: null, agent: nextAgent };
    const targetNative = stageNativeStatus(target.stage);
    // Snapshot do rollbacku (krotka + labele + natywny status)
    const prevLabels = await jira.getLabels(key);
    const prevNative = nativeStatus(fields);
    let didTransition = false;
    try {
      await jira.updateState(key, target, opts.cids);
      // Native status sync — jeśli jeszcze nie na docelowym
      if (prevNative.toLowerCase() !== targetNative.toLowerCase()) {
        const transitions = await jira.getTransitions(key);
        const t = transitions.find(tr => (tr.to?.name ?? '').toLowerCase() === targetNative.toLowerCase());
        if (!t) {
          throw new Error(`brak natywnego transition do '${targetNative}' (dostępne: ${transitions.map(x => x.to?.name).filter(Boolean).join(', ') || 'brak'})`);
        }
        await jira.transitionIssue(key, t.id);
        didTransition = true;
      }
      await dropCandidateLabel(jira, key);
    } catch (e) {
      // Rollback atomowy (best-effort) — przywróć poprzedni stan, status i labele
      try {
        await jira.updateState(key, state, opts.cids);
        if (didTransition) {
          try {
            const transitions = await jira.getTransitions(key);
            const back = transitions.find(tr => (tr.to?.name ?? '').toLowerCase() === prevNative.toLowerCase());
            if (back) await jira.transitionIssue(key, back.id);
          } catch {
            // rollback natywnego statusu best-effort
          }
        }
        const curLabels = await jira.getLabels(key);
        if (JSON.stringify(curLabels) !== JSON.stringify(prevLabels)) {
          await jira.setLabels(key, prevLabels);
        }
      } catch {
        // rollback best-effort — nie maskuj pierwotnego błędu
      }
      throw e;
    }
    const nativeDetail = prevNative.toLowerCase() !== targetNative.toLowerCase() ? `native ${prevNative} → ${targetNative}` : `native ${targetNative}`;
    return {
      key,
      status: targetNative,
      state: stateStr,
      result: 'PICKUP_OK',
      detail: `pickup → ${compactState(target)} (${nativeDetail})`,
    };
  } catch (e) {
    // Przy błędzie spróbuj ustalić status/state do raportu, jeśli to możliwe
    return { key, status: '—', state: '—/—/—', result: 'ERROR', detail: (e as Error).message };
  }
}

/** Eksport dla CLI single-ticket (orchestrate-ticket.mts) — best-effort DEBUG per-ticket. */
export async function logDebugForRow(jira: JiraClient, row: AdvanceRow): Promise<boolean> {
  try {
    const labels = await jira.getLabels(row.key);
    if (!isDebugOn(labels)) return false;
    const body =
      `[AI-generated] Orchestrate — ${row.key} — DEBUG: ${row.result}` +
      (row.detail ? ` — ${row.detail}` : '') +
      `\n\nStan: ${row.status} | ${row.state}`;
    await jira.addComment(row.key, markdownToAdf(body));
    return true;
  } catch {
    return false;
  }
}