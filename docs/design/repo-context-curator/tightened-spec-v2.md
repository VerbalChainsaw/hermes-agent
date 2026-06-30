# Smart Repo Context Curation Spec v2

Status: convergence-driven revision
Date: 2026-06-30
Author: Hermes
Supersedes: `C:\Users\zerop\Development\.hermes\plans\2026-06-30_114553-agents-curation-spec.md`
Basis: external reviews from DeepSeek V4 Pro, DeepSeek V4 Flash, and MiniMax M3

## Goal

Define the smallest useful Hermes extension that:
- learns explicit repo-local operating rules from the current turn
- injects only clearly relevant rules into later turns
- never adds hot-path model calls
- stays small enough to debug and delete if it fails to earn its keep

This v2 intentionally chooses lift over cleverness.
If a feature does not directly help the Phase 1 premise, it is out.

## Bottom-line decision

Build only Phase 1.

Phase 1 is:
- one in-process plugin
- one repo-local `facts.json`
- one `post_llm_call` extractor
- one `pre_llm_call` injector
- one minimal file lock for writes
- zero AGENTS mutation
- zero bootstrap scan
- zero auxiliary-model adjudication

Everything else moves out of the main spec.

## Why this exists

Hermes already has the right hook surfaces:
- `pre_llm_call` can inject turn-local context cheaply
- `post_llm_call` can observe the finished turn
- post-response work already exists elsewhere in Hermes, so this feature does not need to invent a new runtime model

The missing thing is a tiny repo-local memory for facts like:
- use `pnpm`, not `npm`, in this repo
- always run tests for package X from subdirectory Y
- never hand-edit migrations here

The desired outcome is simple:
- fewer repeated user corrections
- fewer misses on known repo conventions
- no prompt wallpaper

## Hard constraints

These are non-negotiable.

1. No extra LLM calls on the hot path.
2. No subprocess or shell-hook spawn on the hot path.
3. No full prior-session scan on any normal turn.
4. No AGENTS mutation in Phase 1.
5. No persistence of assistant-only inference.
6. No unbounded growth in stored facts or injected text.
7. Silence is the default when relevance is weak.
8. If the system is ambiguous, it must skip rather than guess.

## Grounding in Hermes

This design assumes the already-verified Hermes surfaces:
- `pre_llm_call` for live-turn context injection
- `post_llm_call` for end-of-turn extraction
- current-turn-only inspection, not full-session replay
- context injection into the current user message path, not a rewritten system prompt

Implication:
- the live lift must come from `pre_llm_call`
- storage and learning must happen after the turn via `post_llm_call`
- AGENTS is not part of the MVP path

## Scope of v2

### In scope
- repo identity resolution
- tiny repo-scoped fact storage
- explicit-rule extraction from the current turn
- deterministic relevance scoring
- bounded bullet injection
- secret rejection
- minimal write locking

### Out of scope
- AGENTS marker blocks
- branch-scoped hints
- `pending.json`
- `state.json`
- promotion ladders
- confidence scores
- quarantine lifecycle
- stale/revoked/promoted enums
- prior-session bootstrap scan
- repeated-success-pattern mining
- model-based adjudication
- autonomous doc rewriting

## Chosen implementation shape

Use one in-process Hermes plugin.

Why:
- hooks already exist
- plugin logic is cheaper than shell hooks
- the state model is local and deterministic
- rollback is easy: disable the plugin and delete one directory

## Repo identity

The system needs a precise repo key without cross-repo bleed.

### Canonical repo path

When inside a git repo:
- use the git toplevel absolute path

When not inside a git repo:
- use the current working directory absolute path

Normalize it exactly this way:
1. resolve symlinks if the platform/runtime exposes them
2. convert backslashes to `/`
3. strip trailing `/`
4. lowercase on Windows
5. leave case unchanged on case-sensitive platforms

This normalized path is the semantic repo identity.

### On-disk directory name

For filesystem safety only, derive:
- `repo_id = sha256(normalized_repo_path)`

Important distinction:
- the hash is only the directory name
- the actual identity remains the normalized repo path and is stored in the file

This keeps the implementation precise without leaking raw Windows paths into directory names.

## File layout

Under Hermes home:

`~/.hermes/agents-curator/<repo-id>/facts.json`
`~/.hermes/agents-curator/<repo-id>/.lock`

That is it.

No `pending.json`.
No `state.json`.
No AGENTS staging files.

## Fact model

Persist only approved facts.

Candidates that do not meet the approval rule do not get written.
This is deliberate. The MVP does not need a candidate lifecycle.

Each fact record:

```json
{
  "id": "repo_rule:tooling:pnpm-not-npm",
  "text": "Use pnpm, not npm, in this repo.",
  "kind": "repo_rule",
  "source": "user_explicit",
  "scope_path": null,
  "match_terms": ["pnpm", "npm"],
  "created_at": "2026-06-30T00:00:00Z",
  "last_seen_at": "2026-06-30T00:00:00Z"
}
```

### Allowed fields only
- `id`
- `text`
- `kind`
- `source`
- `scope_path`
- `match_terms`
- `created_at`
- `last_seen_at`

### Kind enum
Only one value exists in Phase 1:
- `repo_rule`

### Source enum
Only two values exist in Phase 1:
- `user_explicit`
- `user_correction`

### Field meanings
- `scope_path`: optional repo-relative path such as `apps/foo`; only used when the rule applies to a subdirectory
- `match_terms`: explicit lowercase terms/phrases the injector may match against the current user message

### Explicit exclusions
Phase 1 does not store:
- confidence
- evidence counts
- status
- cooldown timestamps
- expiry timestamps
- branch names or branch-scoped hints
- assistant inference
- tool-proven success patterns

## Approval rule

A fact is persisted only if one of these is true:

### Rule A: explicit repo rule
The current-turn user text matches one of the explicit rule patterns and clearly refers to this repo or a repo path.

Examples:
- "Use pnpm, not npm, in this repo."
- "Never hand-edit migrations here."
- "Always run tests for apps/foo from apps/foo."

### Rule B: explicit correction of a repo rule
The user corrects Hermes and the correction itself contains an explicit repo rule.

Examples:
- "No, use pnpm here, not npm."
- "Actually, tests for apps/foo must run from apps/foo."

If neither rule fires, nothing is stored.

## Extraction rules

Extraction is intentionally dumb, explicit, and narrow.

The extractor examines only the current turn's user-authored text.
It ignores assistant text except as context for detecting that a user correction happened.

### Pattern 1: use X, not Y

Regex shape:
- `\buse\s+(.+?)\s*,?\s*not\s+(.+?)(?:\s+in\s+this\s+repo|\s+here)?[.!]?$`

Result:
- `kind = repo_rule`
- `text = normalized imperative sentence`
- `match_terms = [x, y]` after trimming, lowercasing, and removing quotes/backticks

### Pattern 2: never do X here

Regex shape:
- `\bnever\s+(.+?)(?:\s+in\s+this\s+repo|\s+here)\b[.!]?$`

Result:
- `kind = repo_rule`
- `text = normalized imperative sentence`
- `match_terms = key nouns/commands from X`

### Pattern 3: always run X from Y

Regex shape:
- `\balways\s+run\s+(.+?)\s+from\s+(.+?)\b[.!]?$`

Result:
- `kind = repo_rule`
- `scope_path = normalized repo-relative path Y`
- `match_terms = command words from X plus path Y`

### Correction wrapper handling

If the message begins with one of:
- `no,`
- `nope,`
- `actually,`
- `correction:`
- `don't`

then strip that prefix before testing patterns 1-3.
If a pattern matches after stripping, set `source = user_correction`.
Otherwise store nothing.

### Negative filters

Reject the fact completely if the extracted text contains any of:
- `for now`
- `temporarily`
- `until we fix`
- `unless`
- token-like or secret-like material

Special case:
- if the text says `on this branch`, reject it in Phase 1 instead of storing a branch-scoped fact

### Repeated-success-pattern rule

Removed from Phase 1.

Rationale:
- all three reviews flagged it as the most likely silent misfire
- it adds hidden inference while pretending to be deterministic
- the MVP can prove value without it

## Relevance scoring

The injector must be concrete, not vibes.

### Inputs
- normalized current user message
- normalized current working directory
- approved facts from `facts.json`
- in-memory `last_injected_fact_ids` from the immediately previous turn only

### Per-fact score

Start at `0`.

Add:
- `+3` if any `match_terms` phrase appears in the current user message
- `+2` if `scope_path` is set and cwd is inside that path
- `+1` if `kind == repo_rule`

Reject the fact entirely if:
- the fact id appears in `last_injected_fact_ids`

### Injection threshold

Inject only facts with score `>= 3`.

This is intentionally conservative.
If nothing crosses the threshold, inject nothing.

### Ranking

Sort by:
1. higher score
2. shorter `text`
3. older `created_at`

### Emission cap

Emit at most:
- 3 bullets
- 400 characters total

Format:

```text
Relevant repo context:
- Use pnpm, not npm, in this repo.
- Always run tests for apps/foo from apps/foo.
```

### Cooldown

Phase 1 cooldown is minimal and in-memory only:
- do not inject the same fact on two consecutive turns within the same process
- after process restart, cooldown resets

This avoids per-fact persistent cooldown fields while still reducing immediate wallpaper repetition.

## `pre_llm_call` behavior

Algorithm:
1. Resolve repo identity.
2. If no repo directory exists for that identity, inject nothing.
3. Load `facts.json`.
4. Normalize the current user message and cwd.
5. Score all facts using the concrete scorer above.
6. Keep facts with score `>= 3`.
7. Exclude facts injected on the immediately prior turn.
8. Emit max 3 bullets / 400 chars.
9. Record emitted fact ids in in-memory `last_injected_fact_ids`.

Failure behavior:
- if `facts.json` is missing: inject nothing
- if `facts.json` is corrupt: inject nothing and log debug warning
- if normalization fails: inject nothing

Silence is the default.

## `post_llm_call` behavior

Algorithm:
1. Resolve repo identity.
2. Read only the current turn's user-authored text.
3. Attempt extraction using patterns 1-3.
4. Apply negative filters.
5. If no approved fact emerges, stop.
6. Acquire `.lock`.
7. Re-read `facts.json` if it exists.
8. Upsert by `id`:
   - if new: append
   - if existing: update `last_seen_at` and refresh normalized text if needed
9. Write to temp file in same directory.
10. Atomic rename over `facts.json`.
11. Release lock.

If lock acquisition fails:
- skip the write
- log debug warning
- do not retry in Phase 1

That is a deliberate simplification.

## Write safety

Phase 1 keeps only the smallest write-safety stack worth having.

Required:
- single lock file for mutually exclusive writes
- temp-file write in same directory
- atomic rename

Not required:
- retry loops
- compare-and-swap generations
- pending queues
- AGENTS conflict staging

Reason:
- this is enough to avoid obvious corruption
- anything more makes the MVP harder to trust than the problem it solves

## Storage caps

Hard caps:
- max total facts per repo: `32`
- max injection bullets: `3`
- max injection chars: `400`

Eviction policy when the cap is hit:
1. drop the oldest fact by `last_seen_at`

This is simple, deterministic, and good enough for MVP.

## Secret rejection

Never store a fact if the extracted text contains:
- long token-like strings
- bearer-like prefixes
- key/value secret patterns
- obvious credential material in quotes or code spans

Minimum heuristic:
- reject if any token-like span exceeds 24 chars and matches mixed-case/number secret-ish shape
- reject if text contains `token`, `api_key`, `secret`, `password`, `bearer`, or `auth` adjacent to an assignment-like string

If secret detection is uncertain, reject.

## Failure scenarios and required behavior

### Scenario 1: explicit durable tool rule
User: "Use pnpm, not npm, in this repo."

Required:
- store a `repo_rule`
- inject later only when relevant by score
- do not create AGENTS content

### Scenario 2: subdirectory command rule
User: "Always run tests for apps/foo from apps/foo."

Required:
- store a `repo_rule` with `scope_path = apps/foo`
- inject when cwd is inside `apps/foo` or the message matches terms like `tests` or `apps/foo`

### Scenario 3: temporary branch workaround
User: "On this branch, use the legacy runner until fixture X is fixed."

Required:
- store nothing in Phase 1
- inject nothing later
- do not convert a temporary branch workaround into durable repo memory

### Scenario 4: weak or ambiguous phrasing
User: "Maybe npm is weird here sometimes."

Required:
- store nothing
- inject nothing

### Scenario 5: assistant guessed and user did not explicitly correct with a rule
Assistant guessed wrong; user replies with frustration but no explicit repo rule.

Required:
- store nothing
- do not infer a durable fact from affect alone

### Scenario 6: corrupt facts file
`facts.json` contains invalid JSON.

Required:
- `pre_llm_call`: inject nothing
- `post_llm_call`: do not overwrite blindly; log debug warning and skip write

### Scenario 7: concurrent session write
Another Hermes process holds the lock.

Required:
- skip write
- log debug warning
- do not block the user turn

## Measurement plan

Phase 1 must be measurable or it should die.

During dogfood, capture these debug counters per repo:
- turns where injection fired
- turns where injection did not fire
- facts currently stored
- user corrections that occurred after an injected fact
- repeated user corrections for the same rule after it had already been stored

Success over a dogfood window means:
1. obvious repeated corrections go down
2. no visible latency penalty is noticed
3. users do not complain about repetitive injected wallpaper
4. no secrets are stored
5. no false durable facts become sticky

If the system does not show clear lift, stop and delete it rather than invent Phase 2.

## Default build order

1. plugin skeleton
2. repo identity normalization
3. `facts.json` load/save with lock + atomic rename
4. extractor for patterns 1-3 only
5. injector with the concrete scorer
6. secret rejection
7. dogfood with debug logging
8. decide whether the feature earned a second iteration

## Appendix: explicitly not planned in v2

These are not hidden backlog commitments.
They are excluded on purpose.

### Not planned
- machine-owned AGENTS block
- marker insertion rules
- `pending.json`
- `state.json`
- confidence fields
- promotion ladders
- quarantine / stale / revoked lifecycle
- repeated terminal-shape mining
- auxiliary model review during extraction
- bootstrap scan across older sessions
- cross-session reconciliation jobs

### Condition to reopen any of them
Only reopen a deferred item if dogfood proves one concrete failure that Phase 1 cannot solve without that exact addition.

## Questions for final human review

1. Is the conservative scorer too quiet for the first dogfood pass?
2. Are the regex families narrow enough to stay safe but broad enough to catch the rules you actually say out loud?
3. Is one lock + atomic rename the right minimum, or should even that be cut for the first prototype?
4. Is `scope_path` worth keeping in MVP, or should Phase 1 collapse to flat repo rules only?

## Bottom line

v1 was directionally right but too fat.

v2 is the narrowed version that survived three external reviews:
- one plugin
- two hooks
- one tiny store
- explicit user-stated repo rules only
- concrete scoring
- no AGENTS mutation
- no speculative lifecycle machinery

If this version still feels too big, the next thing to cut is `scope_path`.