# Re-implementation notes — discover

Kruczki z live implementacji `aialm-oss-discover`. Odpowiednik ticketa **AAO-72** (oraz story discover AAO-45/46/47/48/49 pod epicem AAO-31).

Backend: Jira Cloud REST v3. Kandydat trafia do projektu KLIENTA (nie AAO).

- **Ten sam warunek company-managed co onboard** — persist kandydatów zależy od settable screens. `gh-kanban-template` (classic), never next-gen.
- **`ensureSelfAwareFields` idempotentny 3-warstwowo:** (1) create-or-find pola, (2) DODAJ TYLKO BRAKUJĄCE opcje — Jira zwraca 400 na duplikat option, (3) wire pola do screenów klienta. Rozwiązane CIDs są używane do `updateState`.
- **search/jql**: nowy `/rest/api/3/search/jql` (stary `/search` usunięty w tej instancji) zwraca TYLKO `id` gdy nie żądasz pól. Podaj `fields` by dostać `key`+`fields`+`description` — inaczej idempotencja `aialm-external:` nie zadziała.
- **Eventual-consistency**: zaraz po `createIssue`, `updateState` (PUT) potrafi zwrócić transient 404 — potrzebny retry z backoffem (5 prób, ~300ms*próba).
- **Label-sync** (w `updateState`): utrzymuje `aialm:stage:*` + `aialm:role:*` (prefiks globalnie bezpieczny), ZACHOWUJE obce (candidate/recommendation), usuwa przeterminowane `aialm:*`. Filtrowanie: `labels = "aialm:stage:awaiting-human-approval"`. AGENT celowo NIE jest labelem (cardinality).
- Kandydat: `STAGE=AWAITING_HUMAN_APPROVAL / ROLE=PO / AGENT=none` + native `To Do` + label `candidate`+recommendation. `BLOCKED` to label rekomendacji, NIGDY nie stan.
- `listOpenIssues` skip PR, paginacja (duże repo → setki kandydatów).