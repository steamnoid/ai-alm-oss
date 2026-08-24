---
description: Propose implementability analysis (AC in Gherkin) for a READY candidate issue
---
Analyze one READY candidate issue and post atomic proposal comments.

Target candidate: $ARGUMENTS (owner/repo#issue)

Execute the aialm-oss-po-analyze skill (`.opencode/skills/aialm-oss-po-analyze/SKILL.md`):

1. Load the Project AI Profile + candidate qualification.
2. Fetch the full issue body/comments via the adapter seam.
3. Gate: if the recommendation is not READY, post one [AI-generated] Blocked
   — owner/repo#issue comment and stop.
4. LLM-analyze into BLOCKING / NON-BLOCKING / CREATIVE findings (max 2–3
   CREATIVE per run), each with `why` + plain-English Gherkin.
5. Post one Proposal comment per atomic finding via runAnalyze (idempotent by
   proposal id; never merge scenarios; never propose technical safe defaults).
6. Post the summary comment (BLOCKING/NON-BLOCKING/CREATIVE counts + ids).

Only create proposal/summary/blocked comments on the candidate record —
no ALM workitem mutation, no GitHub writes.
