# AGENTS.md — AI ALM OSS (projekt AAO)

Ten plik jest **source of truth** dla modelu self-aware ticketu (state machine zapisana na statusach). Wartości poniżej są na sztywno — nie zmieniaj ich bez jawnej zgody człowieka.

## Self-aware ticket — model statusu (krotka 3 wymiarów)

Status ticketa = konglomerat (krotka) niezależnych wymiarów. Każdy wymiar to osobne pole na tickecie.

### Wymiary i wartości

| Pole | Wartości |
|---|---|
| `STAGE` | `IDLE`, `AWAITING_HUMAN_APPROVAL`, `IN_PROGRESS_BY_AGENT`, `AWAITING_AGENT_PICKUP`, `READY`, `DONE` |
| `ROLE` | `PO`, `DEV`, `QA`, `SEC`, `ARCH`, `AI` |
| `AGENT` | `none` + nazwy skilli `aialm-oss-*` (np. `aialm-oss-po-analyze`, `aialm-oss-qa-analyze`, `aialm-oss-dev-impl`) |

### Semantyka `STAGE`
- `IDLE` — w backlogu, nieaktywny, nie ma piłki
- `AWAITING_HUMAN_APPROVAL` — czeka na człowieka; "na którego" wskazuje `ROLE`
- `AWAITING_AGENT_PICKUP` — czeka, aż wskazany `AGENT` (konkretny skill) ruszy
- `IN_PROGRESS_BY_AGENT` — ten `AGENT` aktualnie wykonuje
- `READY` — gotowy do podchwycenia przez kolejny skill
- `DONE` — ukończone, bez aktywnego opiekuna

### Invarianty spójności (deterministyczne)
- `AGENT=none` ⇔ `STAGE ∈ {IDLE, AWAITING_HUMAN_APPROVAL, DONE, READY}`
- `AGENT≠none` ⇔ `STAGE ∈ {AWAITING_AGENT_PICKUP, IN_PROGRESS_BY_AGENT}`
- `ROLE` definiuje "którego człowieka" tylko przy `AWAITING_HUMAN_APPROVAL`; `AI` = self-aware rola AI — człowiek ustawia `AI` w `AIALM ROLE` by oddać pracę orchestratorowi (handoff)
- `DONE` → `AGENT=none`, `ROLE` opuszcza (brak aktywnego opiekuna)
- `AI` — rola transient: występuje tylko jako `ROLE=AI` przy `AGENT=none` (READY/AWAITING_HUMAN_APPROVAL) jako marker oddania do AI; po `AWAITING_AGENT_PICKUP` wraca do `null`

### Transition table (tylko te przejścia są legalne)
| Od | Do | Kto wyzwala |
|---|---|---|
| `IDLE` → `AWAITING_AGENT_PICKUP` | agent startuje (ustawia `ROLE`+`AGENT`) |
| `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT` | ten sam agent rozpoczyna mutację |
| `IN_PROGRESS_BY_AGENT` → `AWAITING_HUMAN_APPROVAL` | agent skończył, czeka na człowieka (`ROLE`) |
| `IN_PROGRESS_BY_AGENT` → `AWAITING_AGENT_PICKUP` | agent oddał piłkę innemu agentowi |
| `AWAITING_HUMAN_APPROVAL` → `AWAITING_AGENT_PICKUP` | człowiek zatwierdził (✅/APPROVE:<id>) |
| `AWAITING_HUMAN_APPROVAL` → `DONE` | następny etap przejmuje albo ukończone |
| `READY` → `AWAITING_AGENT_PICKUP` | kolejny skill podchwytuje |
| `READY`/`IDLE` → `AWAITING_AGENT_PICKUP` | brak requisitu → idzie do właściwego agenta-dostawcy |

### Zasady obowiązujące
- **Brak `BLOCKED`.** Stany nie zawierają `BLOCKED` — to zbyt rozmyte. Brak requisitu wyrażamy brakiem akcji (ticket zostaje w `IDLE`/`AWAITING_AGENT_PICKUP` wskazując agenta-dostawcę), nigdy abstrakcyjnym "zablokowane".
- **`ROLE` są skalarne** (jeden aktywny opiekun w danym momencie, sekwencja PO→DEV→QA→SEC→ARCH). Przypadek `qa-impl ∥ dev-impl` to osobne child-ticketu, więc per-ticket `ROLE` jest pojedynczy.
- **"Który człowiek"** przy `AWAITING_HUMAN_APPROVAL` = właściciel roli (`ROLE`) z mapy Project Governance — bez osobnego wymiaru `HUMAN`/accountId na tym etapie.
- **Exclusive mutator:** przy `IN_PROGRESS_BY_AGENT` tylko wskazany `AGENT` może pisać; `AWAITING_AGENT_PICKUP` → `IN_PROGRESS_BY_AGENT` musi wiązać ten sam `AGENT`.

### Wdrożenie
- Custom fields w Jira: `AIALM STAGE` (select), `AIALM ROLE` (select), `AIALM AGENT` (select z listą skilli). Default na nowym tickecie: `IDLE` / `none` / `none`.
- Helper w `shared` (`aialm-oss-shared/state.ts`): enumy, `transition(from,to)` z tablicą legalnych przejść, walidacja invariantów, `applyState`.
- Każdy skill `aialm-oss-*`: początek → `IN_PROGRESS_BY_AGENT` + `AGENT=własny` + `ROLE=własna`; koniec → `AWAITING_HUMAN_APPROVAL` (czeka na człowieka) albo `AWAITING_AGENT_PICKUP`/`READY` (oddane kolejce).

## Podział przestrzeni (meta vs klienci)

- **Projekt AI ALM OSS (AAO) = metaprojekt narzędziowy.** W AAO dokumentujemy i rozwijamy **same narzędzia/skille** `aialm-oss-*` (epiki/stories). Pola self-aware `AIALM STAGE/ROLE/AGENT` **nie żyją w AAO** — AAO ich nie ma.
- Każdy **kliencki projekt** (repo) dostaje **własną przestrzeń Jira** (onboarding: nazwa `[AI-ALM] owner/repo`, klucz klienta). Dopiero w projekcie klienta tworzone są pola self-aware `AIALM STAGE/ROLE/AGENT` (select) z wartościami wg powyższego modelu.
- Skille (`discover`, `po-analyze`, …) działają **per-repo**: kandydaty/wyniki trafiają do projektu klienta, **nigdy do AAO**.
- Stories w AAO dokumentują **rozwój narzędzi**, nie pojedyncze repo-uruchomienia.

## Produkt

- **Entry point:** podanie publicznego repozytorium GitHub (`owner/repo`).
- **Exit point:** gotowy, traceable **Pull Request** (po verify + eksplicytnej zgodzie człowieka).
- Pełna pętla: `onboard → discover → po → qa → arch → sec → impl → ship`, gdzie `impl` biegnie sekwencyjnie `dev-analyst → dev-update-approved → dev-impl → qa-impl`, a `ship` to `verify → pr → feedback`.

### Pętla kanoniczna
```
onboard → discover → po → qa → arch → sec → imp
  imp: dev-analyst → dev-update-approved → dev-impl → qa-impl
  ship: verify → pr → feedback
```
Kandydaci/PR żyją w projekcie **klienckim** Jira + w GitHub repo — nigdy w AAO.

### Pickup (człowiek stawia ROLE=AI + STAGE)
- Człowiek oddaje pracę orchestratorowi ustawiając `AIALM ROLE=AI` (przy `STAGE∈{READY,AWAITING_HUMAN_APPROVAL}`, `AGENT=none`) — orchestrator advance ustawia `AWAITING_AGENT_PICKUP` + `ROLE=null` + `AGENT` wg konwencji.
- `ROLE` + `AGENT` przy `AWAITING_AGENT_PICKUP` wypełnia **konwencja** (system/agent postępuje wg tablicy poniżej) — inaczej krotka łamie invariant `AGENT≠none ⇔ {AWAITING_AGENT_PICKUP, IN_PROGRESS_BY_AGENT}`.

| Po bramce | AGENT (konwencja) |
|---|---|
| discover kandydat zatwierdzony | `aialm-oss-po-analyze` |
| AC approved | `aialm-oss-po-prep-decompose` (decompose zawsze w ścieżce: bez splittu → pakiet 1:1, nie skip etapu) |
| decompose done | `aialm-oss-qa-analyze` |
| GENERATED QA approved | `aialm-oss-arch-analyze` |
| ARCH approved | `aialm-oss-sec-analyze` |
| SEC approved | `aialm-oss-dev-analyst` |
| contract approved | `aialm-oss-dev-impl` |
| dev-impl done | `aialm-oss-qa-impl` |
| qa-impl done | `aialm-oss-verify` |
| verify ready | `aialm-oss-pr` (po kolejnej gate człowieka) |

- Discover persist: utworzony kandydat dostaje `STAGE=AWAITING_HUMAN_APPROVAL` / `ROLE=PO` / `AGENT=none` + native Jira `To Do`.
- **qa-impl i dev-impl NIE biegną równolegle.** Kolejność: `dev-impl` przed `qa-impl`. Zakaz cross-read zostaje (żadne z nich nie czytają outputu drugiego jako źródła wymagań).

## Orchestrator `aialm-oss-orchestrate` — advance one step (agentowy klej)

- **Backend:** Jira Cloud. Custom fields `AIALM STAGE/ROLE/AGENT` są źródłem prawdy; `STAGE` wyznacza etap, `ROLE`+`AGENT` są wyprowadzane wg konwencji poniżej. Orchestrator atomowo syncuje krotkę **i** natywny status/kanban wg mapy `STAGE→status` (`Backlog`/`AWAITS AGENT PICKUP`/`AGENT WORKING`/`AWAITS HUMAN APPROVAL`/`Done` — name-based, `STAGE_NATIVE_STATUS` w `orchestrate/index.ts`).
- **Trigger:** skill agentowy, komenda **argumentowa** `/aialm-oss-orchestrate <WELLBEINGT-N>`. Człowiek wywołuje explicite dla jednego ticketa (po uprzednim `ROLE=AI` jako handoff).
- **Bramka discover (jedyna zaimplementowana):** `STAGE∈{READY,AWAITING_HUMAN_APPROVAL}` + `ROLE=AI` + `AGENT=none` + `Backlog` + ludzkie `✅` → `AWAITING_AGENT_PICKUP/null/aialm-oss-po-analyze` + native `AWAITS AGENT PICKUP` (replace `PO` → `AI`; `AI` transient; atomowo krotka + kolumna). Inny `ROLE` → `NOT_CANDIDATE`.
- **Zakres (na start):** wąski wycinek po/qa/dev→e2e (nie cały workflow arch/sec/pr na start). Rozszerzenie wg tablicy pickup.
- **Semantyka „jeden krok" (Wariant I — exclusive mutator):** orchestrator zna całą maszynę stanów i konwencję pickup, ale **nie duplikuje pracy skilli**. Jeden wywołany krok = **jedno legalne przesunięcie kolumny** (jedno przejście `STAGE` z transition table). Orchestrator wybiera następny skill wg konwencji, ustawia krotkę `AWAITING_AGENT_PICKUP` (`ROLE`+`AGENT` wg tablicy) i **oddaje pałeczkę** — to wybrany skill mutuje treść (AC/QA/Contract/impl). Jeśli przesunięcie **nie jest możliwe** — orchestrator **nie mutuje**; zostawia **komentarz na tickecie** wyjaśniający powód (brak aprobaty `✅`/`APPROVE:<id>`, nielegalne przejście, `AGENT≠none` już aktywny, brak requisitu — nigdy `BLOCKED` jako stan, tylko brak akcji + komentarz).
- **Exclusive mutator:** przy `IN_PROGRESS_BY_AGENT` tylko wskazany `AGENT` może pisać; orchestrator sprawdza invariant przed mutacją (konflikt → komentarz, bez zmian).
- **Governance flaga DEBUG (per-ticket, default ON):** każdy ticke ma label `aialm:debug:on` / `aialm:debug:off` (brak obu = `on`). Gdy `on`, **każda** czynność orchestratora (wszystkie wyniki) jest logowana jako komentarz `[AI-generated] Orchestrate — <KEY> — DEBUG: <result> — <detail>` na tickecie. Gdy `off`, DEBUG pomijane — tylko legacy `BLOCKED:` dla nie-zaawansowanych. Labele `aialm:debug:*` zachowywane przez `syncStateLabels` (helper `isDebugOn` w `shared/state.ts`).
- **Raport:** `APPLIED` (przesunięto), `BLOCKED` (komentarz, bez zmian), `SKIPPED` (nic do zrobienia) — plus stan po kroku.
- **Idempotencja:** re-run przy już-przesuniętym pickupie → `SKIPPED` (bez podwójnej mutacji).