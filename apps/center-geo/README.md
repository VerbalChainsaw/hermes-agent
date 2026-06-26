# @hermes/center-geo

> **Status: T00–T24 shipped. Engines + fusion + reports + diff + CI all working.** 303 tests passing. Real-CLI verified end-to-end.

`center-geo` is **CENTER-MULTIGEOMETRY**: a deterministic multi-geometry structural risk scanner for codebases. It is a **companion to [`center-audit`](../../skills/center-audit)**, not a replacement.

`center-audit` is strong when you already have a specific suspected defect and a center anchor. `center-geo` answers the question that comes *before* you have a center:

- Where in the codebase are the high-risk structural regions?
- Which nodes, edges, paths, or boundaries deserve attention?
- What does the codebase look like under multiple graph traversal geometries — radial, cycle, boundary, anomaly, convergent?

It emits **evidence-backed risk hypotheses** with anchors. It does not prove defects. Run `center-audit` afterward to prove or disprove a flagged hypothesis.

## Quick start

```bash
# Run a full scan with all 5 engines + fusion + reports.
node dist/cli/main.js scan --output-dir ./cg-out .

# Compare two reports (e.g. main vs PR).
node dist/cli/main.js diff ./cg-out/main/report.json ./cg-out/pr/report.json
```

## Subcommands

| Subcommand | What it does |
| ---------- | ------------ |
| `index <repo>` | Enumerate the repo and emit a graph snapshot (T02). |
| `scan <repo>`  | Run all 5 engines + fusion + reports. The main entry point. |
| `diff <base> <head>` | Compare two `report.json` files. Exit 1 if any NEW hypothesis is high-severity. |

## Engines

| Engine   | What it detects | Source |
| -------- | --------------- | ------ |
| radial   | Files imported by many other files; deep dependency chains | T09 |
| cycle    | Import cycles + self-loops | T10 |
| boundary | Edges that cross forbidden boundary tag combinations | T11 |
| anomaly  | Nodes whose fan-in or fan-out is in the top percentile | T12 |
| convergent | Nodes reachable from many distinct upstream branches | T13 |

## Output formats

- **Human (stderr)**: top-N hypotheses by fused score, with score, severity, target, geometries.
- **JSON (stdout, `--format json`)**: structured FusedScore[] for machine consumption.
- **File reports (`--output-dir`)**: writes `report.json` (full data), `report.md` (markdown table for PR comments), `report.sarif` (SARIF 2.1.0 for GitHub code scanning).

## Exit codes (FR10)

| Code | Meaning |
| ---- | ------- |
| 0    | OK — no high-severity signals in the top-N. |
| 1    | THRESHOLD — at least one top hypothesis is high-severity. |
| 2    | EXTRACTION_GAP — at least one source file failed to extract. |
| 3    | CONFIG_ERROR — config file is invalid. |
| 4    | REPO_READ_ERROR — repository path is not readable. |
| 5    | INTERNAL — unexpected error. |

## CI integration

See `docs/ci-integration.md` for examples. Sample workflow in `.github/workflows/center-geo.yml`.

## Performance

- **1000-file TypeScript monorepo:** scan completes in **~1.7s** end-to-end (15 engines + fusion + 3 reports).
- **10k-file target:** well under the docs/01 NFR3 30-second budget.
- All algorithms are pure functions on the immutable `GraphStore`; the package is parallelizable for future TBD tickets.

## Architecture

```
src/
  adapters/ts/      T05-T07: TS parser → import/call/symbol edges
  graph/            T03-T04, T08: types, store, BFS/SCC algorithms
  engines/
    radial/         T09: blast-radius from file nodes
    cycle/          T10: import cycle detection
    boundary/       T11: forbidden-crossing detection
    anomaly/        T12: fan-out/fan-in percentile
    convergent/     T13: distinct upstream branch count
  scoring/          T14: fuseSignals() — 8-bonus formula
  output/           T15: formatHuman / formatJson
  reports/          T17-T19: writeJsonReport / writeMarkdownReport / writeSarifReport
  diff/             T24: readReport / diffReports
  cli/              T00: commander-based CLI; subcommand dispatch
```

Every engine is a pure function: `(GraphStore, EngineConfig) -> Signal[]`. All engines run on the same `GraphStore` (read-only) and their outputs are concatenated then fused by `fuseSignals`. Signal ids are SHA-256 (first 16 hex chars) of geometry+type+target+metrics — stable across runs.

## Configuration

Default config is a no-op (no boundaries defined, all engines enabled with sensible defaults). To override, drop a `.center-geo.yml` next to your `package.json` and pass `--config <path>` to the scan. See `examples/center-geometry.config.yaml` (in the requirements package) for the full schema, or `.center-geo.yml` in this directory for a starter.

## Schema versions

- `JsonReport.schema_version = "1.0.0"`
- `DiffReport.schema_version = "1.0.0"`
- `SARIF.version = "2.1.0"`

Bump the version on incompatible changes (per docs/01 §FR7).

## License

MIT. Part of the Hermes agent toolkit.
