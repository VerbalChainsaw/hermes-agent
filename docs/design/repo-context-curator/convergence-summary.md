# Convergence Summary — Smart Repo Context Curation Spec

Reviewed spec:
- `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.md`

Review artifacts:
- DeepSeek V4 Pro: `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.deepseek-pro-review.md`
- DeepSeek V4 Flash: `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.deepseek-flash-review.md`
- MiniMax M3: `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.minimax-m3-review.md`

Models actually used:
- DeepSeek Pro → `deepseek-v4-pro`
- DeepSeek Flash → `deepseek-v4-flash`
- MiniMax → `MiniMax-M3`

## High-confidence convergence

### 1) Keep the core idea; cut the scope hard
All three reviews accept the basic Phase 1 premise — a small, deterministic, repo-local context curator using the existing hook points — but all three want the spec cut down materially.

Evidence:
- DeepSeek Pro says the core Phase 1 is appropriately sized, but Phase 2/3 material does not belong in the MVP (`deepseek-pro-review.md:8-9`, `24-26`, `35-38`).
- DeepSeek Flash says the current spec is over-engineered for MVP and should be stripped to Phase 1 only (`deepseek-flash-review.md:8-10`, `39-47`).
- MiniMax says the design is MVP-sized only if Phase 2/3 are treated as hypothetical and complexity is cut from Phase 1 (`minimax-m3-review.md:8-10`, `37-41`).

### 2) Phase 2 / Phase 3 should move out of the main spec
This is the strongest convergence point.

Evidence:
- Pro: AGENTS rewrite rules are design clutter for an MVP (`deepseek-pro-review.md:24-26`, `35-38`).
- Flash: delete Phase 2 and Phase 3 from the spec until Phase 1 proves value (`deepseek-flash-review.md:30`, `45-47`, `54-56`).
- MiniMax: move Phase 2 and Phase 3 into an appendix / “Not Planned” area so they stop reading like commitments (`minimax-m3-review.md:27`, `49`).

### 3) The fact model is too elaborate
Every reviewer attacked the schema and lifecycle machinery.

Common targets:
- too many statuses
- too many kinds
- confidence scoring that does not mean anything yet
- per-fact cooldown / expiry before proven need
- promotion / quarantine / stale / revoked state before the system has earned that complexity

Evidence:
- Pro: status taxonomy is too fine and `pending.json`/`state.json` add unnecessary I/O complexity (`deepseek-pro-review.md:24-26`).
- Flash: nine-field fact record and multi-status lifecycle are too much for MVP (`deepseek-flash-review.md:19-20`, `25-30`, `50-56`).
- MiniMax: status values, kind count, confidence, cooldown, expiry, branch/subdir metadata all bloat the MVP (`minimax-m3-review.md:20-22`, `25-28`, `44-47`).

### 4) The scoring algorithm is not concrete enough
Every review called out the same hole: the injector is described as deterministic, but the scoring rule is still vibes.

Evidence:
- Pro: `pre_llm_call` scoring is only sketched and needs a concrete formula and thresholds (`deepseek-pro-review.md:18`, `29-32`, `41-44`).
- Flash: relevance scoring is undefined and will drift in implementation (`deepseek-flash-review.md:21`, `33-35`, `52-53`).
- MiniMax: reviewers cannot evaluate lift without a concrete scorer (`minimax-m3-review.md:30-31`, `43-44`).

### 5) Extraction rules are still too hand-wavy
Every review agrees deterministic extraction is fine in principle and under-specified in practice.

Evidence:
- Pro: deterministic extraction is good, but pattern handling and proven-success quantification are underspecified (`deepseek-pro-review.md:14`, `30-31`).
- Flash: regex/pattern rules must be explicit; current wording is too vague (`deepseek-flash-review.md:20`, `33-34`, `51`).
- MiniMax: repeated-success-pattern extraction is the highest-risk rule and likely should be dropped from Phase 1 (`minimax-m3-review.md:19`, `33`, `40`).

### 6) Concurrency / write-safety is heavier than the MVP needs
All three reviews question the size of the locking / atomic-write story relative to the first cut.

Evidence:
- Pro: file-lock contention could silently drop writes and harm trust (`deepseek-pro-review.md:21`, `32`, `44`).
- Flash: file locking + atomic writes are overkill for a local MVP (`deepseek-flash-review.md:22`, `29`, `43`, `53`).
- MiniMax: the current lock + temp-write + reread + retry stack is too much for something meant to be tiny (`minimax-m3-review.md:21`, `28`, `38`).

## Real divergences

### 1) How positive the verdict is
- DeepSeek Pro is the most favorable to the current draft. It thinks the core Phase 1 is already close, with most bloat living in later phases and some missing algorithms (`deepseek-pro-review.md:8-9`).
- MiniMax is cautiously favorable. It thinks the trimmed claim is “largely earned,” but only if you cut more complexity before implementation (`minimax-m3-review.md:8-10`).
- DeepSeek Flash is the harshest. It treats even current Phase 1 as too heavy and wants a much more aggressively minimal implementation (`deepseek-flash-review.md:8-10`, `39-47`).

### 2) How minimal the MVP should be
- Flash wants the most brutal cut: almost flat facts, maybe inject all facts every turn, and maybe no real scoring at all (`deepseek-flash-review.md:39-47`, `50-56`).
- Pro allows a small but real structure: limited statuses, explicit cooldowns, staleness policy, and a concrete scorer (`deepseek-pro-review.md:35-44`).
- MiniMax sits between them: one JSON file, two fact kinds, one write lock, one simple scoring function, but no confidence field or speculative lifecycle complexity (`minimax-m3-review.md:37-49`).

### 3) Repo identity detail
- Flash suggests hashing the absolute path or remote URL (`deepseek-flash-review.md:56`).
- MiniMax argues the opposite: do not hash at MVP; use canonical repo path directly (`minimax-m3-review.md:47`).
- Pro flags the area as under-specified but does not lock in a strong preference (`deepseek-pro-review.md:29-32`).

## Decision-grade takeaway

The reviews do converge, and the convergence is useful:

1. The design direction is valid.
2. The written spec is still too fat.
3. The safe next move is not implementation from this draft.
4. The safe next move is a tighter v2 spec with these rules:
   - Phase 1 only
   - move Phase 2/3 out of the main body
   - kill confidence / promotion / quarantine / stale machinery unless proven necessary
   - define extraction patterns concretely
   - define relevance scoring concretely
   - either greatly simplify or postpone concurrency complexity
   - strongly consider dropping `repeated_success_pattern` from MVP

## Best synthesis of the three reviews

If I had to compress the convergence into one build brief:

Build one plugin using `post_llm_call` + `pre_llm_call`, store a tiny repo-local JSON fact list, extract only explicit user-stated rules at first, inject at most three short bullets, and treat every other feature in the current draft as deferred until dogfood proves it is worth its maintenance cost.
