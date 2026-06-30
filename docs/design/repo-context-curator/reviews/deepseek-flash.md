# DeepSeek V4 Flash Review — Smart Repo Context Curation Spec

Review model: deepseek-v4-flash
Review date: 2026-06-30
Reviewed file: `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.md`

# Verdict
- Over-engineered for an MVP. The spec describes a comprehensive system with multiple phases, elaborate fact models, and concurrency safeguards that are not justified for a first cut.
- Phase 1 alone is still too heavy: the fact model, status enums, promotion rules, and file locking add complexity without proven user benefit.
- The spec claims to be trimmed but retains speculative future work (Phase 2/3) and over-abstracted state management.

# Strengths
- Clear hard constraints (no hot-path LLM calls, no shell subprocesses, bounded growth) are non-negotiable and well-articulated.
- Decision to use a plugin over shell hooks is correct for efficiency.
- Failure scenarios are thought through (secrets, contradictions, concurrency).
- Explicit caps on storage and injection are sensible defaults.

# Risks
- Fact model with nine fields and six statuses is fragile; bugs in status transitions or evidence counting will cause silent incorrectness.
- Deterministic extraction is hand-waved: no concrete patterns, no tie to user intent. Real-world linguistic variation will break simple rules.
- Relevance scoring in `pre_llm_call` is unspecified. Without a defined algorithm, implementation will drift and likely degrade.
- Concurrency file locking and atomic writes add non-trivial complexity for a tool that runs locally on a single machine. Overkill for MVP.
- The whole system may produce negligible lift compared to the cost of maintenance and debugging.

# Over-Engineered Parts
- Fact model with `id`, `key`, `kind`, `status`, `source_kind`, `evidence_count`, `confidence`, `expires_at`, `cooldown_until`. MVP could just store a list of strings with `created_at` and `last_seen_at`.
- Six `kind` values and six `status` values. Half are never used in Phase 1 (e.g., `promoted`, `quarantined`, `stale`). Start with one status: `active`.
- Promotion policy with three tiers (immediate, after two confirmations, never). Unnecessary; just store user-explicit statements as approved, ignore everything else.
- File-level concurrency with lock files, atomic writes, retry. Single-user Hermes sessions are sequential—lock is dead weight.
- Phase 2 and Phase 3 specs (AGENTS block, bootstrap scan) are speculative bloat. Remove entirely from the spec until Phase 1 proves value.

# Under-Specified Parts
- Deterministic extraction rules: the spec lists example positive/negative signals but no concrete implementation. How do you parse "use X, not Y" reliably without NLP? Need explicit regex or pattern matcher spec.
- Relevance scoring: "score each fact against current user message and cwd" is undefined. What scoring function? Could be simple keyword overlap but not stated. This will lead to arbitrary thresholds and inconsistent injection.
- Cooldown mechanism: no detail on how cooldown timer works, how it resets, or how it interacts with per-fact injection limits.
- Repo-ID resolution: "git root hash when inside a git repo" – is that the commit hash? The worktree hash? A SHA of the repo URL? Ambiguous and risky.

# Shrink-to-MVP Recommendation
- Strip to Phase 1 only, and gut Phase 1 to the absolute minimum:
  - Store facts as a flat JSON list of `{text, created_at}`. No statuses, keys, kinds, confidence, evidence.
  - Extraction: only capture exact user statements matching a few simple regexes (e.g., `"use .* not .*"`, `"never .* in this repo"`). Ignore every other pattern.
  - Injection: include all stored facts (up to 3 bullets, 400 chars) every turn without scoring. No cooldown.
  - No file locking, no atomic write operations. Read/write with simple JSON read/write. Assume single session.
  - No AGENTS integration, no pending.json, no state.json. Just `facts.json` and `.lock` (placeholder if needed).
- Remove all discussion of Phase 2/3 from the spec. They are not MVP.
- Remove concurrency section entirely.
- The entire MVP implementation should be under 200 lines of Python plugin code.

# Recommended Changes
1. **Simplify fact model** to `{ "text": "...", "first_seen_at": "..." }`. Drop all enums, confidence, evidence.
2. **Define concrete extraction patterns** (e.g., exact regexes) for the three positive signals that are actually used.
3. **Replace relevance scoring** with a simple rule: inject all facts if the user message contains any keyword from the fact text; otherwise inject all facts anyway (since number is capped). Simpler to implement and debug.
4. **Remove concurrency boilerplate** – lock file is justified only if concurrent Hermes sessions are proven common; start without it.
5. **Delete Phase 2 and Phase 3 sections** from the spec – they are distractions.
6. **Add a explicit "do not implement" list** for every field/enum not used in MVP (e.g., `branch`, `subdir`, `cooldown_until`, `promoted`).
7. **Define repo-id deterministically**: use SHA-256 of the repo's absolute path (or git remote origin URL). Avoid hash ambiguities.
