# Regression Scout — center-geo Risk Anchors

Pull this file when the active change is inside `apps/center-geo/` and you need the repo-specific regression anchors that are easy to miss in a generic regression pass.

## Highest-yield regression surfaces in center-geo

1. **Built CLI vs source-level truth**
   - `npx vitest` can stay green while `node dist/cli/main.js ...` breaks
   - any CLI, formatter, diff, report, or packaging change needs a built-artifact check

2. **Machine-readable stdout contracts**
   - `scan --format json` and `diff` are machine-consumable surfaces
   - stdout must stay parseable by a real JSON parser
   - human commentary belongs on stderr when stdout is contract-bearing

3. **Report trio emission**
   - `report.json`, `report.md`, and `report.sarif` should all be written together when `--output-dir` is used
   - a pass that only checks one file can miss a writer regression in the other two

4. **Engine -> fusion -> downstream coupling**
   - a new geometry or signal type can work locally while fusion, diff, snapshots, or report writers still assume the old shape
   - always check at least one downstream consumer after an engine/pipeline change

5. **Config validation and defaults**
   - config work needs a valid-config path, an invalid-config path, and an omitted-default path
   - regressions often hide in the invalid or omitted case rather than the happy path

6. **Graceful degradation**
   - center-geo frequently carries explicit "fail honestly, do not overclaim" rules
   - when a target cannot be emitted or resolved, the degraded path is itself a regression surface

## Worked example — T25 path-engine packet

A real regression class caught during the 2026-07-02 T25 hardening pass:

### Change Surface

- T25 path engine landed
- CLI tests and built-path proof were green
- `diff` command still claimed to emit JSON to stdout

### Regression Checks

- Built CLI path proof on a symbol-tagged fixture: pass
- Full suite + build: pass
- Standalone `diff` run with stdout piped into `JSON.parse`: fail
- STDERR/STDOUT split check on `diff`: fail

### Findings

- `diff` appended a human decision trailer to stdout after the JSON body, so the command was not actually machine-parseable despite the help text and apparent success path.

### Risk Left Open

- None in this specific contract after the stdout/stderr fix landed, but the class remains relevant for any future CLI/output change.

## What this example proves

A normal "main thing still works" verification pass would have missed the bug. The regression-scout lens catches it because it forces:

- one machine-consumer check for machine-readable output
- one built-artifact check rather than source-only trust
- one adjacent-contract check instead of stopping at the main feature
