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
 */
export function hasHumanApprovalFor(
  comments: readonly CommentLike[],
  id: string,
  opts?: { gatingEmojis?: readonly string[] },
): boolean {
  const gating = opts?.gatingEmojis ?? ['✅', '👍'];

  for (const c of comments) {
    // Reakcja human na KOMENTARZU AI: ludzka reakcja na komentarzu, który
    // niesie proposal:<id>, jest aprobatą (kanał akceptacji). Samo ciało
    // komentarza AI nigdy nie zatwierdza.
    if (c.isAi) {
      if (c.body?.includes(`proposal:${id}`) && c.reactions?.some(r => !r.isAi && gating.includes(r.emoji))) {
        return true;
      }
      continue;
    }

    if (containsExplicitApproval(c.body, id)) return true;

    // Reakcja human na komentarzu (nie AI).
    if (c.reactions?.some(r => !r.isAi && gating.includes(r.emoji))) {
      // Reakcja zatwierdza propozycję TYLKO jeśli komentarz niesie ten proposal:<id>.
      if (c.body && c.body.includes(`proposal:${id}`)) return true;
    }
  }
  return false;
}

export function isAiAuthored(comment: Pick<CommentLike, 'isAi'>): boolean {
  return comment.isAi;
}