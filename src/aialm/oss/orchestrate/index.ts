/**
 * aialm-oss-orchestrate — background gate-advance poller (ograniczony zakres).
 *
 * Bramka DISCOVER_APPROVED (kandydat discover zatwierdzony, w Backlogu):
 *   wejście  (WSZYSTKIE): native status = Backlog  AND
 *                         STAGE=READY / ROLE=PO / AGENT=none  AND
 *                         ludzkie zatwierdzenie kandydata (hasCandidateApproval)
 *   wyjście:            STAGE=AWAITING_AGENT_PICKUP / ROLE=null / AGENT=aialm-oss-po-analyze
 *                         + usunięcie labela `candidate`
 *                         + native kanban → kolumna (default "AWAITS AGENT PICKUP")
 *
 * Źródło prawdy = custom fields (AIALM STAGE/ROLE/AGENT). Labele aialm:*
 * to TYLKO sync z pól (stateLabels/syncStateLabels) — NIGDY odwrotnie.
 * ROLE=null: PO nie jest już odpowiedzialny za tickecik w tym momencie
 * (AWAITING_AGENT_PICKUP z role:null jest spójne — invariant wymaga tylko AGENT≠none).
 * Gdy docelowa kolumna nie istnieje → MISSING_COLUMN (zwrotka).
 */
import type { JiraClient } from '../adapter/jira.js';
import { ensureSelfAwareFields, type SelfAwareCids } from '../adapter/fields-config.js';
import { readStateFromFields, SELF_AWARE_FIELDS } from '../adapter/fields.js';
import { hasCandidateApproval, type CommentLike } from '../shared/approval.js';
import type { AGENT, STAGE, TicketState } from '../shared/state.js';

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
  | 'MISSING_COLUMN'
  | 'ERROR';

export interface AdvanceRow {
  key: string;
  result: AdvanceResult;
  status: string;
  state: string;
  detail?: string;
}

export interface OrchestrateReport {
  projectKey: string;
  rows: AdvanceRow[];
}

/** Bramka: kandydat discover — AWAITING_HUMAN_APPROVAL lub READY (oba „gotowy do pickupu”). */
const SCOPE_STAGES: readonly STAGE[] = ['READY', 'AWAITING_HUMAN_APPROVAL'];
/** AGENT picku dla discover-kandydata (konwencja → po-analyze; ROLE emissji=null). */
const PICKUP_AGENT: AGENT = 'aialm-oss-po-analyze';
/** Native stan, w którym tickecik musi przebywać (Backlog). */
const BACKLOG_STATUS = 'backlog';

/**
 * Ograniczony inferGate: STAGE∈{READY,AWAITING_HUMAN_APPROVAL}, ROLE=PO, AGENT=none
 * (odczyt z custom fields, nie z labeli — labele to pochodna pól). Inny kształt => false.
 */
export function inferGate(state: TicketState): boolean {
  return (SCOPE_STAGES as readonly string[]).includes(state.stage) && state.role === 'PO' && state.agent === 'none';
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

/** Lista WSZYSTKICH ticketów w projekcie (JQL po projekcie — unikamy duplikatów custom field i label drift). */
async function listProjectIssues(jira: JiraClient, projectKey: string): Promise<string[]> {
  const jql = `project = ${projectKey}`;
  const issues = await jira.searchJql(jql, ['key']);
  return issues.map(i => (i as any).key as string);
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
 * Jedno przejście dla jednego kandydata. `statuses` = native kolumny projektu
 * (rozwiązane raz na projekt, nie per issue). Zwraca wiersz raportu —
 * ZAWSZE z `status` i zwartą `state` (krotka z custom fields), niezależnie od wyniku.
 */
export async function advanceOne(
  jira: JiraClient,
  key: string,
  opts: { cids: SelfAwareCids; targetColumn: string; statuses: string[] },
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

    // Warunek wejścia: wygaszony przegląd — najpierw bramka krotki (discover).
    if (!inferGate(state)) {
      return {
        key,
        status,
        state: stateStr,
        result: 'NOT_CANDIDATE',
        detail: `poza bramką discover: krotka ${stateStr} (oczekiwano READY lub AWAITING_HUMAN_APPROVAL / PO / none)`,
      };
    }
    if (!isInBacklog(fields)) {
      return {
        key,
        status,
        state: stateStr,
        result: 'OUT_OF_SCOPE',
        detail: `status=${status} (wymagany Backlog)`,
      };
    }

    const comments = await jira.listComments(key);
    if (!candidateApproved(comments)) {
      return { key, status, state: stateStr, result: 'NO_APPROVAL', detail: 'brak ludzkiego zatwierdzenia (✅)' };
    }

    // Pickup: STAGE=AWAITING_AGENT_PICKUP, ROLE=null (PO już nie odpowiada), AGENT=po-analyze.
    const target: TicketState = { stage: 'AWAITING_AGENT_PICKUP', role: null, agent: PICKUP_AGENT };
    await jira.updateState(key, target, opts.cids);
    await dropCandidateLabel(jira, key);

    // Native kanban: tylko jeśli kolumna istnieje; inaczej zwrotka.
    const hasColumn = opts.statuses.some(s => s.toLowerCase() === opts.targetColumn.toLowerCase());
    if (!hasColumn) {
      return {
        key,
        status,
        state: stateStr,
        result: 'MISSING_COLUMN',
        detail: `brak kolumny '${opts.targetColumn}' — krotka przestawiona na ${compactState(target)}, candidate usunięty`,
      };
    }

    await jira.transitionIssue(key, opts.targetColumn);
    return {
      key,
      status,
      state: stateStr,
      result: 'PICKUP_OK',
      detail: `pickup → ${compactState(target)}, native ${status} → ${opts.targetColumn}`,
    };
  } catch (e) {
    // Przy błędzie spróbuj ustalić status/state do raportu, jeśli to możliwe
    return { key, status: '—', state: '—/—/—', result: 'ERROR', detail: (e as Error).message };
  }
}

/**
 * Jedna iteracja orchestru dla PODANYCH projektów (klienci z parametru CLI,
 * nie z rejestru). Zwrotka zawiera **wszystkie** tickety projektu z powodem
 * przeniesienia / nieprzeniesienia oraz native `status` i zwartą `state`.
 */
export async function runOnce(
  jira: JiraClient,
  projectKeys: readonly string[],
  opts: { targetColumn?: string },
): Promise<OrchestrateReport[]> {
  const targetColumn = opts.targetColumn ?? 'AWAITS AGENT PICKUP';
  const reports: OrchestrateReport[] = [];
  for (const projectKey of projectKeys) {
    try {
      const cids = await ensureSelfAwareFields(jira, projectKey);
      const statuses = await jira.listStatuses(projectKey);
      const keys = await listProjectIssues(jira, projectKey);
      const rows: AdvanceRow[] = [];
      for (const key of keys) {
        rows.push(await advanceOne(jira, key, { cids, targetColumn, statuses }));
      }
      reports.push({ projectKey, rows });
    } catch (e) {
      reports.push({
        projectKey,
        rows: [{ key: '—', status: '—', state: '—/—/—', result: 'ERROR', detail: (e as Error).message }],
      });
    }
  }
  return reports;
}