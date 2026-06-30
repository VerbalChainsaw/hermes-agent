# DeepSeek V4 Pro Review — Smart Repo Context Curation Spec

Review model: deepseek-v4-pro
Review date: 2026-06-30
Reviewed file: `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.md`

# Verdict
- The spec is well-scoped for an MVP: it narrowly defines Phase 1, defers risky features, and aggressively constrains hot-path complexity.
- Over-engineering appears primarily in the detailed Phase 2/3 rules that don’t belong in an initial build; the core Phase 1 is appropriately sized.

# Strengths
- Hard constraints (no extra LLM calls, no subprocess, no full-history scan, etc.) are explicit and enforce strict efficiency.
- The phase split and explicit non-goals prevent scope creep and keep focus on a measurable, minimal delivery.
- Deterministic candidate extraction and strong rules against promoting assistant inferences or temporary patterns reduce risk of pollution.
- Failure scenarios cover the most dangerous cases (secrets, concurrent writes, human override) and mandate a fail-closed posture.

# Risks
- The relevance-gating scoring logic is left vague; a poorly tuned heuristic could either remain silent too often (missing lift) or inject noise.
- Deterministic extraction may miss conventions expressed in softer language, leading to repeated corrections despite the system’s presence.
- Caps (e.g., 64 total facts) could prematurely evict high-value facts in a actively maintained repo, silently degrading the experience.
- Concurrency based on a file lock may occasionally drop writes silently under contention, eroding user trust.

# Over-Engineered Parts
- Phase 2 AGENTS block rewriting rules are exhaustively specified even though the spec itself admits they may never be implemented; this adds design clutter.
- The fact status taxonomy (`candidate`/`approved`/`promoted`/`quarantined`/`stale`/`revoked`) is over-fine for a first iteration; `approved`/`candidate`/`quarantined` would suffice.
- Separate `pending.json` and `state.json` files alongside `facts.json` introduce unnecessary file‑I/O complexity without clear benefit at this stage.

# Under-Specified Parts
- The `pre_llm_call` scoring algorithm is only sketched: no concrete formula, no threshold value, no detail on how cwd/subdir relevance and cooldowns are combined.
- Candidate extraction rules are high‑level (“use X, not Y” patterns) but lack specifics on normalization, deduplication, and how tool‑proven success is quantified.
- Cooldown behaviour and expiry logic (e.g., when does a session_hint expire?) are mentioned but not defined with concrete time windows or triggers.
- The atomic write protocol (temp‑file rename) is named but the exact sequence and error handling (e.g., what happens on partial write) are left implicit.

# Shrink-to-MVP Recommendation
- Cut Phase 2 and Phase 3 from the initial delivery; ship only the plugin, fact store, deterministic `post_llm_call` extraction, and `pre_llm_call` injection.
- Collapse the fact store to a single `facts.json` with statuses limited to `approved`, `candidate`, `quarantined`.
- Reduce default caps to 32 total facts and 16 active approved facts to force simplicity; raise later only if need is proven.
- Provide a manual `hermes facts review` command that lists candidate and quarantined facts for user approval, removing the need for AGENTS block integration in Phase 1.

# Recommended Changes
- Specify a concrete relevance score: e.g., token‑overlap + cwd‑match bonus + kind‑based weight, with a hardcoded 0.5 threshold, and per‑fact cooldown of 5 turns after injection.
- Define cooldown durations explicitly: `session_hint` expires at session end, `branch_hint` after 24 h of last mention, others expire only via staleness eviction.
- Add a staleness policy: if a fact is not referenced or reinforced for 30 days, mark it stale; stale facts are never injected and eligible for eviction when caps are hit.
- Document the atomic‑update protocol fully: open a file‑lock (advisory), read current state, generate new JSON in a temp file inside the same directory, rename, release lock, and log a warning on contention failures.

END REVIEW
