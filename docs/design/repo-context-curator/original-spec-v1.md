# Smart Repo Context Curation Spec

Status: draft for external AI review
Date: 2026-06-30 11:45:53
Author: Hermes

## Goal

Define the smallest safe architecture for a Hermes extension that learns durable repo-local operating facts from conversation history, injects only relevant facts into future turns, and optionally maintains a machine-owned AGENTS block.

This spec is intentionally biased toward:
- efficiency over cleverness
- deterministic rules over extra model calls
- bounded writes over autonomous rewriting
- real lift over theoretical completeness

## Why this exists

Hermes already has three adjacent behaviors:
1. per-turn context injection via `pre_llm_call`
2. post-turn observation via `post_llm_call`
3. background self-improvement for skills/memory after the user already has their answer

What Hermes does not have is a cheap, repo-local memory layer that can accumulate project-specific truths such as:
- use `pnpm`, not `npm`
- never hand-edit migrations in this repo
- tests for package X must run from subdirectory Y
- path Z has its own AGENTS-like local convention

The desired outcome is not "a smarter diary."
The desired outcome is:
- fewer repeated corrections from the user
- fewer misses on known repo conventions
- less need to reread entire prior sessions
- zero prompt-wallpaper behavior

## Hard constraints

These are non-negotiable.

1. No extra LLM calls on the hot path.
2. No subprocess or shell-hook spawn on the hot path.
3. No full prior-session scan on every turn.
4. No rewriting human-authored AGENTS prose.
5. No promotion of assistant speculation into permanent project context.
6. No unbounded growth in injected context or stored facts.
7. Silence is the default: inject nothing when nothing is clearly relevant.

If the design cannot satisfy all seven, it is too expensive or too dangerous.

## Grounding in current Hermes behavior

This design is grounded in existing Hermes mechanics, not generic agent theory.

1. `pre_llm_call` fires once per turn before the tool loop and may inject context into the current user message, not the system prompt. This preserves prompt caching.
   - `website/docs/user-guide/features/hooks.md:509-546`

2. `post_llm_call` fires once per successful turn after the tool loop completes.
   - `website/docs/user-guide/features/hooks.md:591-615`
   - `agent/turn_finalizer.py:316-335`

3. Hermes's own background memory/skill review runs after the response is delivered so it does not compete with the user's live task.
   - `agent/turn_finalizer.py:425-433`

4. AGENTS/context files are loaded at startup and progressively by directory discovery. They are not a live mutable prompt surface for the current turn.
   - `website/docs/user-guide/features/context-files.md:30-49`
   - `website/docs/user-guide/features/context-files.md:105-125`

Implication: if this feature exists, the real-time lift must come from `pre_llm_call` injection. AGENTS updates are durable storage for future sessions, not the primary live mechanism.

## Decision: avoid over-engineering by phasing the system

This spec deliberately splits the design into phases.

### Phase 1: plugin + fact store + relevance-gated injection

Implement only:
- one in-process Hermes plugin
- one repo-scoped fact store
- one `post_llm_call` extractor
- one `pre_llm_call` injector

Do not implement yet:
- automatic AGENTS rewriting
- prior-session bootstrap scan
- auxiliary-model adjudication
- cron jobs
- recursive Hermes subprocesses

This phase should already provide measurable lift.

### Phase 2: optional machine-owned AGENTS block

Only after Phase 1 proves useful and safe:
- add a generated block inside an existing `AGENTS.md`
- write only facts that crossed a high-confidence threshold
- never touch human-authored text outside markers

### Phase 3: explicit bootstrap/reconcile command

Only if needed:
- one bounded scan of the last few relevant sessions to seed the fact store
- not part of the per-turn runtime path

If reviewers think Phase 2 or Phase 3 are unnecessary, the system should still be considered successful if Phase 1 alone provides lift.

## Chosen implementation shape

Use a Hermes plugin, not shell hooks.

Reason:
- shell hooks are fine for prototypes but pay a subprocess cost every turn
- plugins run in-process and fit the required efficiency profile
- this feature needs structured state and deterministic logic, not shell plumbing

## Proposed file layout

Under Hermes home:

`~/.hermes/agents-curator/<repo-id>/facts.json`
`~/.hermes/agents-curator/<repo-id>/pending.json`
`~/.hermes/agents-curator/<repo-id>/state.json`
`~/.hermes/agents-curator/<repo-id>/.lock`

Where `repo-id` is:
- git root hash when inside a git repo
- otherwise normalized working-directory hash

This prevents cross-repo contamination.

## Fact model

Each stored fact should be small and typed.

```json
{
  "id": "fact_001",
  "key": "tooling.package_manager",
  "text": "Use pnpm, not npm, in this repo.",
  "kind": "repo_rule",
  "scope": "repo",
  "status": "approved",
  "source_kind": "user_explicit",
  "evidence_count": 1,
  "confidence": 1.0,
  "first_seen_at": "2026-06-30T11:45:53Z",
  "last_seen_at": "2026-06-30T11:45:53Z",
  "expires_at": null,
  "cooldown_until": null,
  "subdir": null,
  "branch": null
}
```

Minimal enums:

`kind`
- `repo_rule`
- `subdir_rule`
- `command_preference`
- `layout_invariant`
- `session_hint`
- `branch_hint`

`status`
- `candidate`
- `approved`
- `promoted`
- `quarantined`
- `stale`
- `revoked`

`source_kind`
- `user_explicit`
- `tool_proven`
- `user_correction`
- `repeated_success_pattern`
- `assistant_inference`

Important rule: `assistant_inference` alone can never become `approved` or `promoted`.

## Fact classes and what they are allowed to do

### 1. Permanent repo facts

Examples:
- use `pnpm`, not `npm`
- never hand-edit migrations
- package `apps/foo` runs tests from its own directory

Allowed actions:
- eligible for injection
- eligible for Phase 2 AGENTS promotion

### 2. Subdirectory facts

Examples:
- `frontend/` uses one test command
- `backend/` uses another

Allowed actions:
- eligible for injection only when cwd or file path is relevant
- eligible for AGENTS promotion as subdir-scoped bullets if confidence is high

### 3. Session/branch hints

Examples:
- this branch temporarily needs the legacy test runner
- feature flag X is on for current investigation

Allowed actions:
- eligible for injection
- must expire automatically
- never eligible for AGENTS promotion

### 4. Rejected or quarantined facts

Examples:
- transient outage claims
- one-off failures
- contradictions with manual AGENTS prose
- secret-looking values

Allowed actions:
- never injected
- never promoted
- may remain in pending/quarantine for review

## Promotion policy

### Approve immediately

If all are true:
- the user stated it explicitly
- it is repo-local
- it is durable rather than temporary

Examples:
- "Use pnpm in this repo, not npm."
- "Never hand-edit migrations here."

### Approve after two independent confirmations

If all are true:
- supported by tool-observed success or repeated user correction
- not contradicted by current AGENTS text
- not scoped to branch/session only

Examples:
- repeated successful use of the same package-specific test command
- repeated correction that a package lives under a specific subdir

### Never auto-approve

- anything inferred from a single failure
- anything phrased as temporary
- anything conflicting with manual AGENTS text
- anything that looks like a secret
- anything that is really a user preference or reusable procedure rather than repo context

## Hot-path behavior

### `pre_llm_call`

Purpose: inject only the smallest relevant slice of approved repo context.

Algorithm:
1. Load repo-scoped `facts.json`.
2. Filter to:
   - `approved` or `promoted`
   - not expired
   - not in cooldown
3. Score each fact against:
   - current user message
   - cwd / subdir relevance
   - fact kind priority
   - recent injection cooldown
4. Select top results above threshold.
5. Inject at most:
   - 3 bullets
   - 400 characters total
6. If nothing scores above threshold, inject nothing.

Output shape:

```text
Relevant repo context:
- Use pnpm, not npm, in this repo.
- Tests for apps/foo should run from apps/foo/.
```

Notes:
- No persistent mutation occurs here.
- No DB scan occurs here.
- No LLM call occurs here.
- The default outcome should be no injection on many turns.

### `post_llm_call`

Purpose: observe the completed turn and update the fact store cheaply.

Algorithm:
1. Inspect only the current turn slice, not the entire session history.
2. Extract candidate facts using deterministic rules from:
   - explicit user phrasing
   - repeated corrections
   - tool-proven repeated success patterns
3. Normalize and dedupe by key.
4. Update evidence counts/confidence/status.
5. Write only if the store changed.
6. If Phase 2 is enabled and a new fact crossed promotion threshold, stage an AGENTS block refresh.

Notes:
- No LLM call occurs here.
- No prior-session scan occurs here.
- No shell subprocess occurs here.

## Candidate extraction rules

This should stay intentionally dumb and safe.

Positive signals:
- "use X, not Y"
- "never do X in this repo"
- "always run X from Y"
- "this package lives under path Z"
- repeated successful terminal/test usage in the same shape
- explicit user corrections of project conventions

Negative signals:
- "for now"
- "temporarily"
- "on this branch"
- "until we fix"
- failures caused by network/auth/outage
- assistant speculation without user or tool support

Any negative signal should either:
- downgrade to `session_hint` / `branch_hint`, or
- reject entirely

## AGENTS integration rules (Phase 2 only)

This is where the design can get stupid if not bounded.

### Machine-owned block only

The plugin may only touch text between markers:

```md
<!-- HERMES:BEGIN GENERATED DURABLE FACTS -->
<!-- HERMES:END GENERATED DURABLE FACTS -->
```

### Default write posture

Default behavior should be conservative:
- if `AGENTS.md` does not exist, do not create it automatically in initial rollout
- if markers do not exist, either:
  - append them only when explicit config enables AGENTS writes, or
  - stage a pending diff instead of mutating

### Human text always wins

If a promoted fact conflicts with human-authored AGENTS text outside the generated block:
- quarantine the fact
- do not overwrite manual prose
- optionally add an entry to `pending.json`

### Generated block limits

Hard caps:
- 20 bullets max
- 1200 characters max
- deterministic ordering by priority then key

The goal is a compact summary, not a second AGENTS file inside AGENTS.

## Concurrency and write safety

Two sessions may work in the same repo. The system must not eat itself.

Required safeguards:
- file lock around state mutations
- atomic temp-file write then replace
- re-read before AGENTS write
- one retry on stale base, then abort to pending

If anything looks ambiguous, skip the write. This system should fail closed.

## Failure scenarios and required behavior

### Scenario 1: explicit durable repo rule

Input:
- user says: "Use pnpm, not npm, in this repo."

Required behavior:
- create `repo_rule`
- mark `approved` immediately
- eligible for future injection
- Phase 2 may promote to AGENTS block

### Scenario 2: transient failure

Input:
- command fails because npm registry timed out

Required behavior:
- do not infer a permanent tool rule
- do not promote anything
- maybe record nothing at all

### Scenario 3: branch-local workaround

Input:
- user says: "On this branch, use the legacy test runner until fixture X is fixed."

Required behavior:
- classify as `branch_hint`
- inject only while relevant
- set expiry
- never promote to AGENTS

### Scenario 4: assistant guessed wrong once

Input:
- assistant says something plausible but wrong

Required behavior:
- no promotion based on assistant text alone
- require later user/tool confirmation before any approval

### Scenario 5: human AGENTS conflict

Input:
- generated fact says use tool X
- manual AGENTS prose says use tool Y

Required behavior:
- quarantine the generated fact
- do not overwrite human text
- stage for review if needed

### Scenario 6: growth without bound

Input:
- months of sessions create dozens of facts

Required behavior:
- cap promoted facts
- cap generated AGENTS block
- mark stale facts and evict low-value inject-only hints first

### Scenario 7: secret accidentally observed

Input:
- tool output includes token-like material

Required behavior:
- reject and never store
- never inject
- never write to AGENTS

### Scenario 8: concurrent sessions

Input:
- two Hermes sessions update the same repo state

Required behavior:
- lock, compare-and-swap, retry once, else abort safely

## Efficiency budget

The system is only acceptable if it stays cheap.

### Per-turn budget

`pre_llm_call`
- one small JSON read
- deterministic scoring over a bounded fact list
- no subprocess
- no LLM
- no history scan

`post_llm_call`
- current-turn-only analysis
- one write only on change
- no subprocess
- no LLM
- no session DB scan

### Storage caps

Suggested defaults:
- total facts: 64
- promoted/approved durable facts: 32
- inject-only hints: 16
- pending/quarantined facts: 16

These are defaults, not sacred numbers, but the system must stay hard-capped.

### Injection caps

Suggested defaults:
- max 3 bullets
- max 400 chars
- per-fact cooldown after injection

The aim is lift, not wallpaper.

## Explicit non-goals

Not in scope for initial implementation:
- mining the full session database every turn
- multi-model review loops
- auto-generating skills or memory entries
- rewriting arbitrary AGENTS prose
- becoming a general knowledge base
- replacing user-written project docs

## Rollout plan

### Phase 1 success criteria

After dogfooding, all should be true:
1. noticeable improvement in remembering repo-local conventions
2. no obvious turn-latency penalty
3. no prompt wallpaper effect
4. zero cases of storing secrets
5. zero cases of promoting assistant-only speculation

### Phase 2 gate

Do not enable AGENTS writing until Phase 1 proves:
- the fact taxonomy is correct
- relevance gating is not noisy
- approved facts are actually useful

### Phase 3 gate

Do not add bootstrap/reconcile until there is concrete evidence that Phase 1 misses too much because it lacks bounded historical seeding.

## Recommended default build order

If this spec is approved, build in this order:
1. plugin skeleton
2. repo-id resolution + fact-store I/O
3. deterministic `post_llm_call` candidate extraction
4. deterministic `pre_llm_call` relevance gating
5. caps, cooldowns, expiry, secret rejection
6. dogfood Phase 1 only
7. revisit whether Phase 2 is even worth it

## Questions for external AI reviewers

1. Is Phase 1 alone the right MVP, or is AGENTS block writing required from the start?
2. Are the promotion rules too strict or too lax?
3. Is deterministic extraction sufficient, or is there one narrowly-bounded place where an auxiliary model would materially help without creating a cost/safety problem?
4. Are the proposed caps too small, too large, or about right?
5. Is the distinction between durable repo facts and temporary branch/session hints crisp enough?
6. Are there failure modes not covered here, especially around concurrency, trust erosion, or silent prompt bloat?
7. Is there an even smaller architecture that provides similar lift?

## Bottom line

Yes, the earlier idea could have become over-engineered.

This spec is the trimmed version:
- one plugin
- two hook points
- one small fact store
- no hot-path model calls
- no recursive agents
- no full-history scans
- optional AGENTS integration only after Phase 1 earns the right to exist

That is the line.
