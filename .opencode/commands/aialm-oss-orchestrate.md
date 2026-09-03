---
description: Advance one governed step for a single ticket (WELLBEINGT-N); moves exactly one column or leaves a BLOCKED comment.
---

Advance one governed step for a single ticket (argument-based, one step). Moves exactly one column or leaves a BLOCKED comment.

Target ticket: $ARGUMENTS (WELLBEINGT-N)

Execute the aialm-oss-orchestrate skill (`.opencode/skills/aialm-oss-orchestrate/SKILL.md`):

1. Read WELLBEINGT-N with AIALM STAGE/ROLE/AGENT (custom fields) + comments/reactions.
2. Derive current state + approval (✅/APPROVE:<id>) + requisites. Bramka discover: `ROLE` musi być `AI` (handoff człowiek→AI), inaczej `NOT_CANDIDATE`.
3. Pick next AGENT by the pickup convention (AGENTS.md table).
4. Advance ONE column (one legal STAGE transition) to AWAITING_AGENT_PICKUP/null/AGENT + native AWAITS AGENT PICKUP (AI transient → null; atomowo krotka custom fields + natywny status kanban via transitionIssue), or leave a BLOCKED/DEBUG comment if not possible (exclusive mutator, never BLOCKED as STAGE).
5. Governance flaga DEBUG (per-ticket `aialm:debug:on`/`aialm:debug:off`, default ON): gdy ON, każda czynność logowana jako `[AI-generated] Orchestrate — <KEY> — DEBUG: …` na tickecie.
