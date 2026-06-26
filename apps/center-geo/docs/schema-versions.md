# Schema Versions (T26)

This document tracks the schema versions emitted by `center-geo` and
how to handle a schema bump.

## Current versions (v1.0.0)

| Schema | Version | Location |
| ------ | ------- | -------- |
| `JsonReport` | `1.0.0` | `src/reports/json.ts` |
| `DiffReport` | `1.0.0` | `src/diff/compare.ts` |
| SARIF | `2.1.0` | `src/reports/sarif.ts` |
| Graph snapshot | (TBD — `1.0.0` once T22 snapshot tests land) | `src/graph/types.ts` |

## Bumping a schema

When you change a schema in a backwards-incompatible way:

1. Update the version constant (e.g. `schema_version: "1.0.0"` → `"1.1.0"`).
2. Add a note in this document.
3. Update the snapshot golden files in `test/snapshots/small/`.
4. Update any consumer code that hardcoded the old shape.

## Bumping policy

- **Major bump (1.0.0 → 2.0.0):** field renames, removals, type changes.
- **Minor bump (1.0.0 → 1.1.0):** additive changes — new optional fields, new enum values.
- **Patch (1.0.0 → 1.0.1):** clarifications, no structural change.

The schema_version in the JSON is what consumers check. Document the
specific change in this file.
