# MiniMax M3 Review — Smart Repo Context Curation Spec

Review model: MiniMax-M3
Review date: 2026-06-30
Reviewed file: `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.md`

# Verdict
- Sized appropriately for an MVP if Phase 2 and Phase 3 are treated as hypotheticals, not roadmap commitments. The "trimmed version" claim is largely earned.
- Spec is self-aware about cost and safety but still leaks complexity in the fact model, scoring function, and concurrency layer that Phase 1 does not actually need.
- Recommend: cut to the smallest thing that can prove the premise, ship that, only then reconsider what (if anything) earned its keep.

# Strengths
- Hard constraints are explicit and falsifiable. "No extra LLM calls on the hot path" is the right anchor; it forces the design toward deterministic extraction, which is also the cheapest, safest choice.
- Hot-path budgets are quantified (one JSON read, max 3 bullets, 400 chars). Bounded injection budgets are the single most important defense against prompt bloat.
- Failure scenarios are concrete and the required behaviors are sensible, especially the secret-rejection and human-text-wins cases. Most specs skip this entirely.
- Phasing is honest. Naming Phase 2/3 as optional and explicitly admitting they may be unnecessary is unusual and welcome.

# Risks
- `source_kind: repeated_success_pattern` is the extraction rule most likely to silently misfire. "Repeated terminal usage in the same shape" without a model judge will routinely overfit to coincidence (e.g., user ran `ls` three times). It needs either much stricter shape matching or to be dropped from Phase 1.
- Confidence scores with no calibration are a smell. `confidence: 1.0` for one user utterance and `0.7` for two confirmations is a fiction; downstream gating will eventually rely on numbers that mean nothing.
- The `.lock` file plus atomic temp-write plus re-read plus retry-once is four safety mechanisms stacked. That is fine, but it also means Phase 1 cannot be "tiny." A single-process lock or even SQLite-with-WAL would be simpler and less bug-prone.
- `cooldown_until`, `expires_at`, `branch`, `subdir` fields on every fact bloat the schema before there is evidence any of them matter. Cooldown can start as a global "last N turns" list; expiry can be a per-kind default.

# Over-Engineered Parts
- Five status values (`candidate`, `approved`, `promoted`, `quarantined`, `stale`, `revoked`) for a system that, at MVP, only needs `approved` vs `not approved`. `promoted` is a Phase 2 concept leaked into Phase 1's data model.
- Six `kind` values when two (`repo_rule`, `branch_hint`) cover the actual MVP behavior. `subdir_rule` and `layout_invariant` can collapse; `session_hint` and `branch_hint` are the same thing with different TTLs.
- The full Phase 2 AGENTS-marker machinery, including "append markers only when explicit config enables" plus "stage a pending diff instead," is two fallback policies for a feature that may not ship. Pick one later.
- Concurrency section is a mini-spec. For Phase 1, "single-writer per repo via OS file lock, drop write on contention" is enough.

# Under-Specified Parts
- The relevance scoring function in `pre_llm_call` is described as "deterministic" but never defined. "Score against user message, cwd, fact kind priority, cooldown" is a wish, not an algorithm. Without one concrete scorer (even a bad one), reviewers cannot evaluate lift.
- `repo-id` derivation: "normalized working-directory hash" is undefined. What normalization? Case? Symlinks? Docker mount paths? This determines whether two clones of the same repo share or fragment facts.
- "Repeated successful terminal/test usage in the same shape" has no shape definition. Tokenized command? AST diff? First three tokens? This is the rule most likely to misfire and is least specified.
- No definition of what the injector does when `pre_llm_call` fires but facts.json is corrupt, missing, or locked. Spec says "silence is the default" but does not enumerate the failure modes that should trigger silence vs surface an error.
- No telemetry or measurement plan beyond "noticeable improvement." If Phase 1 success is not measurable, it cannot be gated.

# Shrink-to-MVP Recommendation
- One plugin, two hooks, one JSON file, two fact kinds, one status (`approved` or not), one scoring function (substring + cwd match), one write lock, one cap (32 facts, 3 bullets, 400 chars).
- Drop: AGENTS markers, `promoted` status, `cooldown_until` per fact, `expires_at` per fact, `pending.json`, `state.json`, quarantine lifecycle, assistant-inference promotion path.
- Replace `repeated_success_pattern` extraction with a literal: "only extract from explicit user phrasing in the current turn." No history, no inference. If that is too sparse, add one narrowly-scoped rule and dogfood.
- Keep the failure scenarios as a checklist, but defer the ones that require Phase 2 (AGENTS conflict) or multi-session data (growth without bound) until the data exists.

# Recommended Changes
- Define the scoring function concretely, even if crudely (e.g., "substring match against user message; cwd match against subdir; tie-break by first_seen_at"). Reviewers cannot grade a black box.
- Collapse `kind` to `repo_rule` and `branch_hint`. Drop `scope`, `subdir`, `branch` from the fact record; encode subdir as a key prefix if needed.
- Drop `confidence` field entirely for Phase 1. Replace promotion tiers with a single rule: user said it explicitly in this turn, or it was corrected by the user twice. Count, not score.
- Specify `repo-id` normalization exactly: canonical git toplevel absolute path, lowercased, trailing-slash stripped, symlinks resolved. No hash; just the path. Hashing adds collision risk for zero benefit at MVP.
- Add a measurement section: which turns get injection, how many, and a before/after on user corrections over a dogfood window. Without this, Phase 2 gate is unfalsifiable.
- Move all of Phase 2 and Phase 3 into an appendix labeled "Not Planned." The current inline phasing reads as commitment; an appendix reads as honest optionality.
