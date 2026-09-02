# Re-implementation notes — onboard

Kruczki z live implementacji `aialm-oss-project-onboard`. Odpowiednik ticketa **AAO-71** (oraz story onboard AAO-42/43/44 pod epicem AAO-30).

Backend: Jira Cloud REST v3. Tylko konto AI ALM OSS (aialmoss@icloud.com). NIGDY Plane.

- **Company-managed template to warunek.** Użyj `com.pyxis.greenhopper.jira:gh-kanban-template` (classic), NIE `gh-simplified-*` (next-gen). Screens team-managed NIE są sterowane przez REST → pola self-aware nie są settable (500 przy update).
- Self-aware pola tworzone **per-klient** (label `AIALM STAGE/ROLE/AGENT`, select) i podpinane do screenów projektu klienta (prefix nazwy `<KEY>:`). W metaprojekcie AAO tych pól NIE ma.
- `ProfileCollector` zbiera commands z GitHub Actions; gdy brak workflow — fallback do `package.json` scripts (`npm run typecheck/test/build`). Każde pole MISSING jest jawne (never invented).
- Governance: przy pierwszym onboardzie wszystkie ROLE = lead accountId; Flags `sec`/`arch` domyślnie `on`.
- Idempotencja: provision reuse po kluczu projektu; governance/profile po label+title.
- DELETE projektu Jira uwalnia nazwę/klucz asynchronicznie (~3 min purge); restacje po kasowaniu są nieadresowalne (zombie screens).