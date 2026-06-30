# Repo Context Curator

Status: design packet, not implemented
Location owner: Hermes core/plugin design work
Recommended baseline: `tightened-spec-v2.md`

## What this is

This folder captures the design work for a minimal repo-local context curation mechanism for Hermes.

The intended shape after review tightening is:
- one in-process plugin
- one small repo-local fact store
- `post_llm_call` extraction of explicit user-stated repo rules
- `pre_llm_call` relevance-gated injection of only the useful rules
- no AGENTS mutation
- no hot-path model calls
- no speculative lifecycle bureaucracy

## Why this folder exists

The original draft lived in a scratch planning area outside the repo.
That was fine for iteration, but not fine for long-term review or implementation.
This folder is the git-tracked design packet.

## Artifact map

### Primary specs
- `original-spec-v1.md` — the first full draft
- `tightened-spec-v2.md` — the narrowed version after external-review convergence; this is the version to implement from if the project proceeds
- `convergence-summary.md` — synthesis across the external reviewers

### External reviews
- `reviews/deepseek-pro.md`
- `reviews/deepseek-flash.md`
- `reviews/minimax-m3.md`
- `reviews/usefulness-review-deepseek-v4-pro.md` — post-tightening review focused specifically on usefulness vs over-engineering

## Current recommendation

If this work proceeds, proceed from `tightened-spec-v2.md`, not from v1.

v2 keeps the useful core idea and cuts the expensive fluff:
- Phase 1 only
- explicit user-stated repo rules only
- deterministic extraction
- deterministic scoring
- bounded injection
- minimal write safety

That said, the latest outside usefulness review argues that even this v2 is still too clever for the gain.
Its recommendation is to pivot from auto-extraction to a dumb explicit command such as `/repo-rule add ...` and skip natural-language inference entirely.

## Remaining decision gate

Before implementation, get one more outside opinion specifically on usefulness:
- does this meaningfully reduce repeated user corrections?
- is the remaining Phase 1 shape small enough to justify itself?
- is this still over-engineered relative to the gain?

That review has now been added as a tracked artifact.

## Implementation posture

Do not implement the auto-extraction design yet.

The current outside-opinion result is:
- the problem is real
- the current v2 may still be over-engineered for the payoff
- the best next build, if any, is a much smaller explicit repo-rule mechanism rather than conversational rule inference
