---
name: regression-scout
description: Use when a change already appears to work and you need focused regression hunting before calling it done. Map the changed surface, shared code paths, output contracts, config edges, and built artifacts, then run bounded adjacent checks that look for breakage in neighboring flows rather than re-proving the main fix.
---

# Regression Scout

A post-change regression lens for repo-local coding work. Use it after a fix, refactor, feature, schema change, or CLI/output change when the main path seems okay and the real question is: what else might this have broken?

## Stance

- Start from the diff or changed files, not the whole repository.
- The goal is adjacent breakage, not re-proving the main feature claim from scratch.
- Keep the search bounded: changed files, direct consumers, one shared-helper layer, and one built or distributed surface if the change ships through a build/package step.
- Prefer runnable checks over speculation: focused tests, CLI commands, JSON parses, built-artifact runs, neighboring routes, and config validation.
- A concern is not a regression. Only call it a regression when you can reproduce the break or point to a concrete broken contract.
- If nothing breaks, say so directly and still name the highest-risk area you could not rule out.

## When to Use

Use this skill when:

- the user says "check for regressions", "what else might this have broken", "scan the surrounding area", or "make sure there are no holes"
- a change touched a shared helper, serializer, adapter, parser, config loader, CLI surface, schema, report shape, or exit-code behavior
- a fix or refactor appears correct but could have collateral fallout in adjacent flows
- you are about to declare a risky change done and want one bounded pass over neighboring surfaces first

## Don't Use For

- proving the original bug or feature claim without checking adjacent surfaces
- broad security review with no concrete change surface (use `security-review`)
- pure test-coverage review of a diff (use `review-test-risk`)
- broad contract or compatibility review with no specific change packet (use `review-contract-boundaries`)

## Workflow

1. Define the change surface.
   - files changed
   - public surfaces changed (CLI flags, stdout/stderr, JSON/report shape, config schema, exit codes, event payloads)
   - direct consumers and sibling flows
   - built artifacts or generated outputs that downstream users actually touch
2. Choose regression zones.
   - sibling commands, routes, or flows
   - machine consumers (JSON parsers, scripts, snapshots, report readers)
   - error, empty, threshold, and invalid-config paths
   - shared helpers, adapters, or serializers
   - build-vs-source parity
   - large-input, edge-case, or degraded-behavior paths
3. Run a minimum check budget.
   - at least 4 checks total
   - at least 1 adjacent happy-path check
   - at least 1 error/empty/config-edge check
   - if any machine-consumable surface changed, at least 1 machine-consumer check
   - if the change ships through a build/package step, at least 1 built-artifact check
4. Report only concrete findings, near misses, and the highest-risk area still left open.
5. Use the exact output headings below.

## Check Matrix

Use the matrix below to pick checks that match the change class.

1. **CLI, stdout/stderr, or report-output changes**
   - run the built artifact, not just source-level tests
   - parse machine-readable stdout with a real parser
   - verify stderr carries human-only commentary when stdout is meant for machines
   - verify exit codes still mean what callers expect
2. **Config, validation, or defaulting changes**
   - one valid-config check
   - one invalid-config check
   - one omitted-default path to confirm fallback behavior
3. **Parser, adapter, or identifier-mapping changes**
   - one intended path that proves the change worked
   - one adjacent sibling path that shares the same mapping or emitted IDs
   - one degraded or missing-target path that must fail honestly rather than overclaim
4. **Engine or analysis-pipeline changes**
   - one direct signal-producing scenario
   - one downstream consumer check (fusion, report writer, snapshot, diff)
   - one nearby engine or geometry path to ensure no silent coupling break
5. **Build or packaging-sensitive changes**
   - run the packaged or built artifact
   - verify output files or side effects exist where users expect them
   - verify source-level tests are not the only oracle

Pull `references/check-matrix.md` when you want a slightly fuller matrix of change-class to check-class mappings.

## How to Report

- Anchor each check to a command, test target, route, file path, or consumer.
- Under `### Regression Checks`, include a result on every line: `pass`, `fail`, `concern`, or `N/A`.
- If a machine-consumer check failed but the human-facing surface looked fine, treat that as a real finding — machine consumers are users too.
- If the pass is clean, say `none found` under `### Findings` instead of padding the report.
- Under `### Risk Left Open`, name the single highest-risk area you did not fully rule out.

## Output Format

Use these exact H3 headings in this order.

### Change Surface

- <surface>

### Regression Checks

- <check and result>

### Findings

- <regression or `none found`>

### Risk Left Open

- <untested but plausible issue>

## Common Failure Patterns

1. **Source tests pass, built artifact breaks.** The code is fine in-process but the packaged CLI, compiled output, or generated file diverges.
2. **Human output works, machine consumer breaks.** A tool claims JSON but appends commentary, changes field names, or moves human text onto stdout.
3. **Config drift hides the regression.** Happy-path config works, but invalid input, omitted defaults, or older config shapes no longer behave the same way.
4. **Shared-helper fix breaks a sibling path.** The changed helper now serves the main flow but a neighboring caller depended on the old shape or semantics.
5. **Adjacent consumer stayed stale.** The engine, adapter, or serializer changed, but report writers, snapshots, diff logic, or downstream readers still expect the old contract.
6. **No regression found, but the wrong risk is left open.** If you skip the highest-risk leftover area, the pass looks clean while the biggest uncertainty remains untouched.

## Repo-local note for `apps/center-geo`

When the repo is `apps/center-geo`, the highest-yield regression surfaces are usually:

- source tests vs built `dist/cli/main.js` parity
- `scan` / `diff` JSON contracts, stdout-vs-stderr separation, and exit codes
- `report.json`, `report.md`, and `report.sarif` emission
- engine -> fusion -> report/diff downstream coupling
- config validation, omitted defaults, and invalid-config behavior
- snapshot/golden stability after shape-affecting changes

Pull `references/center-geo-risk-anchors.md` when the active change is inside center-geo and you want the repo-specific regression anchors plus a worked example of the class of bug this skill is meant to catch.

## Mini Example

### Change Surface

- Pagination helpers changed and export shares the same serializer path

### Regression Checks

- Empty export after pagination change: pass
- Auth failure path after serializer error: concern
- Bulk export with large dataset: N/A
- Built CLI export command on sample payload: pass

### Findings

- none found

### Risk Left Open

- Bulk export path shares the serializer but was not exercised at production-sized payloads

## Rules

- Keep the headings exactly as written: `### Change Surface`, `### Regression Checks`, `### Findings`, `### Risk Left Open`.
- Under `### Regression Checks`, list at least 4 checks and include a result on each line.
- If a machine-consumable surface changed, at least 1 check must exercise a real machine consumer.
- If the change ships through a build/package step, at least 1 check must exercise the built or packaged artifact.
- Under `### Findings`, say either `none found` or name the concrete regression(s).
- Do not spend most of the run re-testing the exact feature claim.
- Bias toward adjacent breakage.
- If nothing breaks, still name the highest-risk area you could not rule out.
