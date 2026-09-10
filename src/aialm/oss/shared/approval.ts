/**
 * aialm-oss-shared — human approval semantics (pure).
 *
 * ZatwierdzoneIFF jedno z:
 *  - ludzka reakcja ✅ lub 👍 na komentarzu AI zawierającym proposal:<id>
 *  - ludzki komentarz zawierający APPROVE:<id> (albo approve/LGTM + id)
 *
 * Reakcje AI NIE liczą się. Poza zakresem: reactivation/ladowanie reakcji
 * (to adapter). Tu czysta decyzja na wejściowym kształcie komentarzy.
 */
import { isAiMarked } from './identity.js';

export interface Reaction {
  emoji: string;
  isAi: boolean;
}

export interface CommentLike {
  body?: string | null;
  isAi: boolean;
  reactions?: Reaction[];
}

/** Czy dany komentarz (treść human) zawiera APPROVE:<id> (lub approve/LGTM + id). */
export function containsExplicitApproval(body: string | null | undefined, id: string): boolean {
  const t = (body ?? '').toLowerCase();
  if (t.includes(`approve:${id}`)) return true;
  return (
    t.includes(`approve`) &&
    t.includes(id)
  );
}

/**
 * Decyzja o akceptacji propozycji o danym id. `comments` = wszystkie komentarze
 * w wątku (AI i human), `reactions` na komentarzu. NotFound → false.
 *
 * ZatwierdzoneIFF:
 *  - ludzka reakcja ✅/👍 NA komentarzu AI niosącym `proposal:<id>`;
 *  - ludzki komentarz z ciałem `APPROVE:<id>`/LGTM+id;
 *  - ludzki komentarz-wstawka z samym emoji ✅/👍 (bez `proposal:<id>`) —
 *    zatwierdza **najbliższą poprzedzającą** propozycję AI w wątku
 *    (komentarze jako źródło prawdy), jeżeli ta niesie `proposal:<id>`.
 */
export function hasHumanApprovalFor(
  comments: readonly CommentLike[],
  id: string,
  opts?: { gatingEmojis?: readonly string[] },
): boolean {
  const gating = opts?.gatingEmojis ?? ['✅', '👍'];

  // (A) Jawne APPROVE:<id>/LGTM+id w ciele dowolnego ludzkiego komentarza,
  //     oraz ludzka reakcja gating na komentarzu niosącym ten proposal:<id>.
  for (const c of comments) {
    if (containsExplicitApproval(c.body, id)) return true;
    if (c.reactions?.some(r => !r.isAi && gating.includes(r.emoji)) &&
        c.body?.includes(`proposal:${id}`)) return true;
  }

  // Znajdź ostatni (najpóźniejszy) komentarz AI niosący ten proposal:<id>.
  let lastProp = -1;
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i]!;
    if (c.isAi && isAiMarked(c.body) && c.body?.includes(`proposal:${id}`)) {
      lastProp = i;
    }
  }
  if (lastProp === -1) return false;

  // (B) Reakcja human (✅/👍) bezpośrednio na komentarzu AI z tym proposal:<id>.
  if (comments[lastProp]!.reactions?.some(r => !r.isAi && gating.includes(r.emoji))) return true;

  // (C) Komentarze jako źródło prawdy — ludzka wstawka `✅`/`👍` (body-emotka,
  //     osobny komentarz bez proposal:<id>) PO pozycji propozycji zatwierdza ją.
  for (let i = lastProp + 1; i < comments.length; i++) {
    const cc = comments[i]!;
    const t = cc.body ?? '';
    if (!cc.isAi && gating.some(e => t.includes(e)) && !/^\[AI-generated\]/i.test(t.trim())) {
      return true;
    }
  }

  return false;
}

export function isAiAuthored(comment: Pick<CommentLike, 'isAi'>): boolean {
  return comment.isAi;
}

/**
 * Kandydat-approval: ludzka akceptacja BLOKU REFERENCYJNEGO (samego kandydata,
 * nie konkretnej propozycji AC). Nie wymaga `proposal:<id>` — to gate dla
 * discover-candidate (DISCOVER_APPROVED). Ludzka reakcja gating (✅/👍) lub
 * jawne approve/LGTM w treści komentarza human. Reakcje AI się nie liczą.
 */
export function hasCandidateApproval(
  comments: readonly CommentLike[],
  opts?: { gatingEmojis?: readonly string[] },
): boolean {
  const gating = opts?.gatingEmojis ?? ['✅', '👍'];
  for (const c of comments) {
    // In dev the AI and human share the same account — isAi alone can't
    // distinguish. Only skip strictly AI-generated proposal comments.
    const isStrictAi = c.isAi && isAiMarked(c.body);
    if (isStrictAi) continue;
    // Reakcja human na dowolnym komentarzu w wątku to sygnał zgody na kandydata.
    if (c.reactions?.some(r => !r.isAi && gating.includes(r.emoji))) return true;
    const t = (c.body ?? '').toLowerCase();
    // Emoji in body (ADF emoji nodes become text) also count when reactions API is unavailable
    if (gating.some(e => t.includes(e.toLowerCase()))) return true;
    if (t.includes('approve') || t.includes('lgtm') || t.includes('looks good')) return true;
  }
  return false;
}