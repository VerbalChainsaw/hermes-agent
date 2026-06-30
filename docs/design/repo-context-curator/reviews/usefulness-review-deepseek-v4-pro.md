# Outside usefulness review

Model: deepseek-v4-pro
Date: 2026-06-30
Prompt focus: usefulness vs over-engineering after the v2 simplification

---

1. Verdict  
The feature tries to solve a real, repetitive-correction problem, but the Phase 1 auto‑extraction from free‑form text is too brittle to deliver enough benefit. The parsing rules will miss most repo‑rule statements, the term‑matching scorer will inject at the wrong times too often, and the whole machinery adds latent complexity that a simpler memory‑command would avoid.

2. Is this actually useful in practice?  
Barely. Users don’t phrase rules with the precise “use X, not Y” / “never do X here” / “always run X from Y” templates reliably. The injection fires only when the user’s message contains the stored **match_terms**, so the most valuable rule (“use pnpm”) won’t appear when the user says “install a new package” unless they happen to mention “npm” or “pnpm” – which defeats the purpose of preventing the wrong tool from being used. The benefit is therefore marginal at best, and it’s unlikely to make a noticeable dent in repeated corrections during dogfood.

3. What still feels over‑engineered, if anything?  
The entire extraction pipeline is over‑engineered for the expected payoff. Regex parsers, correction‑prefix stripping, negative filters, secret‑rejection heuristics, lock+atomic‑rename persistence, eviction by `last_seen_at`, and multi‑factor scoring – all to capture a handful of rule stubs that could just be recorded explicitly by the user with a `/remember` command. The design is trying to be clever (infer rules from natural conversation) when a dumb, user‑triggered store would be far more reliable, easier to maintain, and doesn’t risk silently missing rules.

4. What is the minimum version worth shipping?  
A user‑explicit `/repo-rule add "use pnpm, not npm"` command that writes a flat list of strings to a tiny file. On every turn, unconditionally inject exactly those strings (capped at a small character limit) as a static pre‑message block. No parsing, no scoring, no term‑matching – pure user‑driven memory. That gets you the actual value (stop forgetting a handful of crucial rules) with about 30 lines of code, zero false negatives, and zero false positives.
