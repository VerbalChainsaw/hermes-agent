---
name: skeptic-verifier
description: |
  Use when the user wants an adversarial double-check of a code or config change. Run the strongest checks available such as targeted tests, edge-case repros, command runs, or API calls, try to break the claim, look for hidden regressions, and return PASS, PARTIAL, or FAIL with evidence. Good triggers include "poke holes in this", "stress test this change", "double check this fix", and "try to break it".
---

# Skeptic Verifier

## Goal

Determine whether a claimed fix or feature actually works under adversarial scrutiny.

## Workflow

1. State the claim you are verifying in one sentence.
2. Identify the most likely ways the claim could be false:
   - wrong happy-path behavior
   - hidden regressions
   - environment-specific breakage
   - incomplete edge-case handling
   - stale assumptions in tests or manual verification
3. Build a short verification plan biased toward falsification, not confirmation.
4. Run the strongest checks available. Prefer functional proof over code inspection alone.
5. Report one of:
   - `PASS`: evidence supports the claim and no material counterexample was found
   - `PARTIAL`: some evidence exists, but important risks remain untested or unresolved
   - `FAIL`: a counterexample, regression, or missing requirement was found

## Output Format

Use this structure:

### Claim

<what was supposed to be true>

### Attempts To Break It

- <attempt 1>
- <attempt 2>

### Evidence

- <observed proof>

### Verdict

`PASS` | `PARTIAL` | `FAIL`

### Remaining Risks

- <only if applicable>

### Mini Example

- Claim: "empty input no longer crashes the parser"
- Attempt to break it: rerun parser with empty string, whitespace-only input, and malformed JSON
- Verdict: `PARTIAL` if empty string passes but malformed JSON handling was not checked

## Rules

- Do not grade based on effort or code quality. Grade the claim.
- Prefer the shortest path to disproof.
- If verification was mostly static review, say so explicitly.
- If the environment blocks strong verification, return `PARTIAL`, not `PASS`.
