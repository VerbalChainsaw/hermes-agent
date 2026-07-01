---
name: regression-scout
description: |
  Use when the user wants regression hunting after a change. Identify nearby flows, shared code paths, error states, and configuration edges that may have broken even if the main fix works, then run focused checks such as related tests, adjacent commands, or neighboring API paths. Good triggers include "check for regressions", "what else might this have broken", and "test the surrounding area".
---

# Regression Scout

## Goal

Look for unintended fallout around a change rather than re-proving the intended feature from scratch.

## Workflow

1. Define the change surface:
   - files changed
   - affected user flows
   - neighboring modules, commands, routes, or states
2. Identify likely regression zones:
   - adjacent flows that share code paths
   - old behaviors likely to have been invalidated
   - error handling and empty-state behavior
   - auth, config, caching, persistence, and performance edges
3. Run focused checks against those zones.
   - nearby test targets
   - adjacent commands or routes
   - empty, error, auth, and config-dependent paths
4. Report regressions found, near misses, and untested high-risk areas.
5. Format the report with the exact section headings below.

## Output Format

Use these exact H3 headings in this order.

### Change Surface

- <surface>

### Regression Checks

- <check and result>

### Findings

- <regression or "none found">

### Risk Left Open

- <untested but plausible issue>

### Mini Example

### Change Surface

- Pagination helpers changed and export shares the same serializer path

### Regression Checks

- Empty export after pagination change: pass
- Auth failure path after serializer error: concern
- Bulk export with large dataset: N/A

### Findings

- No confirmed regression in empty export flow
- Possible auth error formatting regression when serializer throws

### Risk Left Open

- Bulk export path shares serializer but was not exercised at production-sized payloads

## Rules

- Keep the headings exactly as written: `### Change Surface`, `### Regression Checks`, `### Findings`, `### Risk Left Open`.
- Under `### Regression Checks`, list at least 3 checks and include a result on each line such as `pass`, `fail`, `concern`, or `N/A`.
- Under `### Findings`, say either `none found` or name the concrete regression(s).
- Do not spend most of the run re-testing the exact feature claim.
- Bias toward adjacent breakage.
- If nothing breaks, still name the highest-risk area you could not rule out.
