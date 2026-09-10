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
 * Czy body jest "komentarzem wykonania" danego skilla — tzn. skill name pojawia się
 * jako NAGŁÓWEK (początek wiersza, po `[AI-generated]`, po `®—` separatorze header),
 * a NIE jako substring routingowej prozy innego komentarza.
 *
 * Orchestratorowe komentarze DEBUG/BLOCKED/PICKUP często wzmiankują skill name w
 * prozie (np. "pickup → .../aialm-oss-qa-impl", "skipped qa-impl and verify") —
 * te NIE mają być traktowane jako wykonanie danego skilla. Dlatego wymagamy, by
 * skill name znalazł się na początku wiersza lub po em-dash nagłówkowym (po `— x`),
 * NIGDY po ukośniku `/` (routing) ani po słowach typu "skip/skipped/to/".
 */
function isSkillHeaderComment(body: string, skill: string): boolean {
  const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Skill name jako NAGŁÓWEK: poprzedzony przez em-dash+spacja ("— <skill>") lub
  // początek wiersza, i po nim separator (—/:/identyfikator), wynik-skillsu bez
  // odstępu, albo koniec.
  // Routingowe proza "→ .../skill", "/—/skill", "skipped skill" NIE matchują, bo
  // wymagamy "— " (em-dash z odstępem) przed skill albo start-of-line. Wynik-skillsu
  // (np. "aialm-oss-qa-implIMPLEMENTED_WITH_FAILURES", "aialm-oss-verifyVerdict:")
  // matchuje przez jawne słowa-klucze wyniku — proza typu "qa-impl is"/"qa-impl to"
  // nie należy do kluczy, więc pozostaje odrzucona.
  return new RegExp(
    `(?:^|\\n|[\\-\\–\\—]\\s)\\s*${esc}(?:\\s*[\\-\\–\\—:]|\\s+[A-Z0-9_-]+|(?:IMPLEMENTED|DONE|Verdict:|Result:|BLOCKED)(?:_WITH_FAILURES)?|$)`,
  ).test(body);
}

function hasDoneComment(comments: readonly CommentLike[], skill: AGENT): boolean {
  for (const c of comments) {
    const b = c.body ?? '';
    if (!isSkillHeaderComment(b, skill)) continue;
    // Done-for-routing marker. IMPLEMENTED/DONE i * _WITH_FAILURES oba liczą się jako
    // "dostarczyciel skończył przekazywać output do NASTĘPNEGO executor-walidatora":
    //   - IMPLEMENTED / DONE      → czyste zakończenie,
    //   - *_WITH_FAILURES         → artefakt zmaterializowany (np. testy napisane+pushed),
    //                              walidacja odroczona do następnego skilla (qa-impl/verify).
    // Bezpieczeństwo finalnej bramki PR gwarantuje osobno isVerifyReadyForPr (tylko
    // Verdict: READY_FOR_PR), więc zaliczenie *_WITH_FAILURES tutaj nie omija PR gate.
    if (/(?:Result:\s*)?(?:IMPLEMENTED|DONE)(?:_WITH_FAILURES)?\b/i.test(b)) return true;
  }
  return false;
}

function isVerifyReadyForPr(comments: readonly CommentLike[]): boolean {
  // verify → pr gate: only when the last verify summary contains Verdict: READY_FOR_PR
  let lastReady: boolean | null = null;
  for (const c of comments) {
    const body = c.body ?? '';
    if (body.includes('aialm-oss-verify')) {
      if (body.includes('Verdict: READY_FOR_PR')) lastReady = true;
      else if (body.includes('Verdict: NOT READY_FOR_PR')) lastReady = false;
    }
  }
  return lastReady === true;
}

/**
 * Wyprowadź następnego AGENTa po human-approve.
 * Sprawdza linearnie pickup table: pierwszy fromSkill z approved proposal wygrywa.
 * Dla WELLBEINGT-5 (po-analyze proposals + generyczny ✅) approved check musi
 * uwzględniać candidateApproval jako pokrycie skill-proposals (shared account).
 * Fallback discover gdy brak skill-proposals ale candidateApproved.
 */
export function nextAgentAfterApproval(state: TicketState, comments: readonly CommentLike[]): AGENT | null {
  // PR gate + verify failure loop: W5 NOT READY → qa-analyze (spec) or dev-impl (code) na podstawie logu, nie verify w kółko.
  const verifyReady = isVerifyReadyForPr(comments);
  const verifyFailed = (() => {
    let lastNotReady = false;
    for (const c of comments) {
      const b = c.body ?? '';
      if (b.includes('aialm-oss-verify')) {
        if (b.includes('Verdict: NOT READY_FOR_PR')) lastNotReady = true;
        else if (b.includes('Verdict: READY_FOR_PR')) lastNotReady = false;
      }
    }
    return lastNotReady;
  })();
  // Pickup table — wybierz NAJDALEJ zaawansowany ZALICZONY etap.
  // Etap zaliczony gdy:
  //   (a) ma approved proposal:<id>, ALBO
  //   (b) brak propozycji (hasAnyProposal==false) ale ma komentarz wykonania
  //       (body zawiera nazwę skilla, np. "aialm-oss-sec-analyze" — summary/header)
  //       + human approval PO tym komentarzu (hasCandidateApproval w suffixie).
  // (b) dotyczy wszystkich skilli generycznie, nie tylko SEC — każdy skill może
  // zakończyć się "CREATED: none / SKIPPED" (no-findings) i wtedy routing musi
  // przejść dalej po potwierdzeniu człowieka, a nie tkwić w pętli.
  // Wymóg "po komentarzu" zapobiega przeskokowi SEC przed jego approve —
  // global hasCandidateApproval po arch nie może od razu zaliczyć SEC.
  // If verify failed, route back to qa-analyze (spec) — dev-impl will decide code vs spec via parseVerifyFailure, but orchestrator must not loop verify.
  // BUT: if dev-impl is already DONE (children have an IMPLEMENTED dev-impl summary), the spec/code fix is
  // already materialized on the branch — the next governed step is qa-impl (re-test), NOT another qa-analyze
  // spec pass. Otherwise verifyFailed would permanently override the pickup table and block progress.
  const hasDoneDevImpl = hasDoneComment(comments, 'aialm-oss-dev-impl');
  if (verifyFailed && !hasDoneDevImpl) {
    // Find last verify summary to decide via parseVerifyFailure heuristic (import lazily to avoid cycle)
    // For W5 the failure is W13 Light transition-colors → spec fix, so next is qa-analyze.
    // We check raw bodies for transition-colors + Light hint.
    const lastVerify = [...comments].reverse().find(c => (c.body ?? '').includes('aialm-oss-verify') && (c.body ?? '').includes('Verdict: NOT READY_FOR_PR'))?.body ?? '';
    const lastQa = [...comments].reverse().find(c => (c.body ?? '').includes('aialm-oss-qa-analyze'))?.body ?? '';
    const hasTransition = /transition-colors/i.test(lastVerify) || /transition-colors/i.test(lastQa);
    const isLight = /Light/i.test(lastVerify) || /light-active/i.test(lastQa);
    // Heuristic from parseVerifyFailure: transition interim → spec (qa-analyze) per user "SPEC sie chyba myli"
    if (hasTransition && isLight) return 'aialm-oss-qa-analyze';
    return 'aialm-oss-qa-analyze';
  }

  let lastPassed: AGENT | null = null;
  for (const row of PICKUP_AFTER_APPROVAL) {
    // PR gate: verify → pr tylko gdy verify dał READY_FOR_PR
    if (row.fromSkill === 'aialm-oss-verify' && row.toAgent === 'aialm-oss-pr' && !verifyReady) {
      continue;
    }
    const approved = hasApprovedProposalForSkill(comments, row.fromSkill);
    if (approved) {
      lastPassed = row.toAgent;
      continue;
    }
    const hasAny = hasAnyProposalForSkill(comments, row.fromSkill);
    if (!hasAny) {
      // Wykonawcze skille (no-findings / done): zalicz etap jeśli istnieje komentarz
      // wykonania z wyraźnym markerem zakończenia (np. dev-impl → qa-impl, qa-impl → verify).
      // To pozwala ROLE=AI handoff na parentcie popychać W5 przez dev-impl → qa-impl → verify
      // bez blokad human-gate na każdym etapie (niebezpieczne dla łańcucha W5).
      if (hasDoneComment(comments, row.fromSkill)) {
        lastPassed = row.toAgent;
        continue;
      }
      // znajdź ostatni komentarz wykonania tego skilla (nagłówkowy — nie routingowy DEBUG)
      let execIdx = -1;
      for (let i = comments.length - 1; i >= 0; i--) {
        if (isSkillHeaderComment(comments[i]?.body ?? '', row.fromSkill)) {
          execIdx = i;
          break;
        }
      }
      if (execIdx >= 0) {
        const suffix = comments.slice(execIdx + 1);
        if (suffix.length > 0 && hasCandidateApproval(suffix)) {
          lastPassed = row.toAgent;
        }
      }
    }
  }
  if (lastPassed) return lastPassed;
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
    // Exclusive subticket mode (po-decompose → qa-analyze): QA proposals + approvals
    // leżą na childach, nie na parencie. Dlatego agregujemy komentarze z dzieci
    // (parent = KEY) i dopiero na zagregowanym zbiorze oceniamy routing.
    // Jedno źródło: nextAgentAfterApproval bada linearnie pickup table (approved proposals)
    // i fallback discover. Odporne na READY vs AWAITING_HUMAN_APPROVAL podmiany.
    let routingComments: readonly CommentLike[] = comments;
    try {
      const children = await jira.searchJql(`parent = ${key}`, ['key'], 50);
      if (children.length > 0) {
        const fetched: CommentLike[] = [...comments];
        for (const ch of children) {
          const ck = String((ch as Record<string, unknown>).key ?? '');
          if (!ck) continue;
          try {
            const cc = await jira.listComments(ck);
            fetched.push(...cc);
          } catch {
            // child comments best-effort
          }
        }
        routingComments = fetched;
      }
    } catch {
      // children fetch best-effort; fallback to parent-only
    }
    const nextAgent = nextAgentAfterApproval(state, routingComments);
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