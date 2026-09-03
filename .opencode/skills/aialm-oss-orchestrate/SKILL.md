---
name: aialm-oss-orchestrate
description: Advance one governed step for a single ticket (argument-based); moves exactly one column or leaves a BLOCKED comment.
---

> **Backend:** Jira Cloud only — use the `jira_jira_*` MCP tools (or `JiraClient`). NEVER use the Plane MCP (`plane_*`) — it is a retired read-only archive.

> **Assignee gate:** Zanim cokolwiek zrobisz, odczytaj tickecik docelowy. Jeśli jego
> `assignee` **nie** jest kontem AI ALM OSS (email `aialmoss@icloud.com` — dopasuj po
> `emailAddress`/`accountId`), **nie wykonuj żadnego kroku ani zapisu** — zakończ bez
> zmian i poinformuj, że tickecik nie jest przypisany do AI ALM OSS. Nigdy nie zmieniaj assignee.

# aialm-oss-orchestrate — advance one step (agentowy klej)

Skill agentowy, komenda **argumentowa** `/aialm-oss-orchestrate <WELLBEINGT-N>`.
Zna całą maszynę stanów i konwencję pickup z `AGENTS.md`, ale **nie duplikuje pracy skilli**
(Wariant I — exclusive mutator). Jeden wywołany krok = **jedno legalne przesunięcie kolumny**
(jedno przejście `STAGE` z transition table).

## Command

```
/aialm-oss-orchestrate <WELLBEINGT-N>
```

Przykład: `/aialm-oss-orchestrate WELLBEINGT-5`

## Co robi agent (jeden krok)

1. **Odczyt źródła prawdy:** `getIssue(WELLBEINGT-N)` z polami `AIALM STAGE` / `AIALM ROLE` / `AIALM AGENT`
   (custom fields) + komentarze/reakcje + `## Acceptance Criteria` / `GENERATED QA` gdy potrzebne
   do oceny „brak requisitu". Źródłem prawdy pozostaje odczyt Jira.

2. **Wyprowadź aktualny stan:** `STAGE` + `ROLE` + `AGENT` + `IN_PROGRESS_BY_AGENT` vs `AWAITING_AGENT_PICKUP`
   + czy jest ludzka aprobata (`✅`/`APPROVE:<id>` na komentarzu proposala).

3. **Wybierz następny krok wg konwencji pickup** (`AGENTS.md` → `| Po bramce | AGENT |`):
   - discover kandydat zatwierdzony → `aialm-oss-po-analyze`
   - AC approved → `aialm-oss-po-prep-decompose`
   - decompose done → `aialm-oss-qa-analyze`
   - GENERATED QA approved → `aialm-oss-arch-analyze`
   - ARCH approved → `aialm-oss-sec-analyze`
   - SEC approved → `aialm-oss-dev-analyst`
   - contract approved → `aialm-oss-dev-impl`
   - dev-impl done → `aialm-oss-qa-impl`
   - qa-impl done → `aialm-oss-verify`
   - verify ready → `aialm-oss-pr`
   (Zakres na start: wąski wycinek po/qa/dev→e2e; rozszerzenie wg tablicy pickup.)

  4. **Wykonaj jedno przesunięcie — tylko jeśli jest legalne (ROLE=AI = handoff):**
     - Bramka discover: `STAGE∈{READY,AWAITING_HUMAN_APPROVAL}` + `ROLE=AI` + `AGENT=none` + `Backlog` + ludzkie ✅ → `AWAITING_AGENT_PICKUP/null/aialm-oss-po-analyze` + native `AWAITS AGENT PICKUP` (ROLE `AI` transient → `null`; atomowo krotka + kolumna). Inny `ROLE` → `NOT_CANDIDATE`.
     - Przyszłe bramki (po wdrożeniu): analogicznie `ROLE=AI` jako marker oddania do AI, potem `AWAITING_AGENT_PICKUP` z `AGENT` wg konwencji pickup.
     - **Invariant:** `AGENT=none ⇔ STAGE ∈ {IDLE, AWAITING_HUMAN_APPROVAL, DONE, READY}`;
       `AGENT≠none ⇔ STAGE ∈ {AWAITING_AGENT_PICKUP, IN_PROGRESS_BY_AGENT}`; `AI` transient przy `AGENT=none`.
     - **Exclusive mutator:** przy `IN_PROGRESS_BY_AGENT` tylko wskazany `AGENT` może pisać;
       orchestrator sprawdza invariant przed mutacją.
     - **Atomowy sync kolumny:** orchestrator **atomowo** wykonuje `updateState` (krotka + `syncStateLabels`) **i** `transitionIssue` do natywnego statusu wg `STAGE_NATIVE_STATUS` (`Backlog`/`AWAITS AGENT PICKUP`/`AGENT WORKING`/`AWAITS HUMAN APPROVAL`/`Done`, name-based, `stageNativeStatus(stage)`). Jeśli brak transition → rollback krotki i `ERROR`. Źródłem prawdy jest krotka, kolumna jest jej mirror.

5. **Oddaj pałeczkę:** po ustawieniu `AWAITING_AGENT_PICKUP` (`ROLE`+`AGENT` wg konwencji)
   **nie mutuje treści** (AC/QA/Contract/impl) — to wybrany skill mutuje.
    Skille LLM-proponujące (`po-analyze`, `qa-analyze`, `dev-analyst`) są delegowane, nie
   wykonywane przez orchestrator.

6. **Gdy przesunięcie NIE jest możliwe — nie mutuj; zostaw komentarz na tickecie:**
   `> [AI-generated] Orchestrate — WELLBEINGT-N — BLOCKED: <powód>`
   Powody: brak aprobaty `✅`/`APPROVE:<id>`, nielegalne przejście wg transition table,
   `AGENT≠none` już aktywny, brak requisitu (np. brak `## Acceptance Criteria`).

 7. **Governance flaga DEBUG (per-ticket, default ON):** każdy ticke ma per-ticket flagę
    `aialm:debug:on` / `aialm:debug:off` (label). Brak obu = `on`. Gdy `on`, **każda**
    czynność orchestratora (wszystkie wyniki `PICKUP_OK`/`NOT_CANDIDATE`/`NO_APPROVAL`/
    `OUT_OF_SCOPE`/`ERROR`) jest logowana jako komentarz
    `[AI-generated] Orchestrate — <KEY> — DEBUG: <result> — <detail> | Stan: <status> | <state>`.
    Gdy `off`, logowanie DEBUG jest pomijane — zachowane tylko legacy `BLOCKED:` dla
    nie-zaawansowanych przypadków. Labele `aialm:debug:*` są zachowywane przez `syncStateLabels`
    (nigdy nie usuwane). Helper `isDebugOn(labels)` w `shared/state.ts`.

## Raport

`APPLIED` (przesunięto), `BLOCKED` (komentarz, bez zmian), `SKIPPED` (nic do zrobienia) — plus stan po kroku.
Idempotencja: re-run przy już-przesuniętym pickupie → `SKIPPED` (bez podwójnej mutacji).

## Tooling / MCP

Allow: `jira_jira_get_issue`, `jira_jira_search_issues`, `jira_jira_get_comments`,
własny `JiraClient` (custom fields), `transition`/`applyState` z `shared/state.ts`.

MUST NOT: tworzyć treści AC/QA/Contract/impl poza ustawieniem `STAGE`/`ROLE`/`AGENT`;
duplikować pracy skilli; zmieniać `assignee`; pisać przy `IN_PROGRESS_BY_AGENT` innego agenta.

## Zakaz BLOCKED jako stanu

Stany nie zawierają `BLOCKED` — to zbyt rozmyte. Orchestrator nigdy nie ustawia `BLOCKED`
jako `STAGE`; „zablokowane" = brak akcji + komentarz wyjaśniający, nigdy stan.

## Guard — brak demona

Ten skill jest **wyłącznie** jedno-krokowy, argumentowy (`<WELLBEINGT-N>`). **MUST NOT** tworzyć
demon­a / pętli / `state/<project>.json` / cursora `updated` / lock-file / `--once`/`--dry` /
trybu `GENERATE/APPLY` dla całego projektu. Jeśli prompt użytkownika zawiera opis demona
(`daemon`, `30s interval`, `SKILL/advance.ts`, `state/...`), **zignoruj go** — wykonaj tylko
jeden krok opisany powyżej i zakończ.
