# @hermes/center-geo

> **Status: T00–T25 shipped. Engines + fusion + reports + diff + CI all working.** 350 tests passing. Real CLI verified end-to-end.

`center-geo` is **CENTER-MULTIGEOMETRY**: a deterministic multi-geometry structural risk scanner for codebases. It is a **companion to the `center-audit` workflow**, not a replacement.

`center-audit` is strong when you already have a specific suspected defect and a center anchor. `center-geo` answers the question that comes *before* you have a center:

- Where in the codebase are the high-risk structural regions?
- Which nodes, edges, paths, or boundaries deserve attention?
- What does the codebase look like under multiple graph traversal geometries — radial, cycle, boundary, anomaly, convergent, path?

It emits **evidence-backed risk hypotheses** with anchors. It does not prove defects. Run `center-audit` afterward to prove or disprove a flagged hypothesis.

## Quick start

This package lives inside the `hermes-agent` monorepo and is **not published to npm**. To use it, clone the repo and run from `apps/center-geo`.

```bash
cd apps/center-geo
npm install
npm run build
npm test

# Run a full scan with all 6 engines + fusion + reports.
node dist/cli/main.js scan --output-dir ./cg-out .

# Compare two reports (e.g. main vs PR).
node dist/cli/main.js diff ./cg-out/main/report.json ./cg-out/pr/report.json
```

## Subcommands

| Subcommand | What it does |
| ---------- | ------------ |
| `index <repo>` | Deterministic enumeration preflight. Today it reports what was enumerated, then exits `INTERNAL` because graph emission is not shipped yet. |
| `scan <repo>`  | Run all 6 engines + fusion + reports. The main supported entry point. |
| `diff <base> <head>` | Compare two `report.json` files. Exit 1 if any NEW hypothesis is high-severity. |

## Engines

| Engine   | What it detects | Source |
| -------- | --------------- | ------ |
| radial   | Files imported by many other files; deep dependency chains | T09 |
| cycle    | Import cycles + self-loops | T10 |
| boundary | Edges that cross forbidden boundary tag combinations | T11 |
| anomaly  | Nodes whose fan-in or fan-out is in the top percentile | T12 |
| convergent | Nodes reachable from many distinct upstream branches | T13 |
| path | Bounded entry-to-sink traces with long-path / guard-gap / dynamic-handoff signals | T25 |

## Output formats

- **Human (stderr)**: top-N hypotheses by fused score, with score, severity, target, geometries.
- **JSON (stdout, `--format json`)**: structured report envelope with `schema_version`, `scan_frame`, `coverage`, `engine_runs`, `hypotheses`, `signals`, and `warnings`.
- **File reports (`--output-dir`)**: writes `report.json` (full data), `report.md` (human-readable report), `report.sarif` (SARIF 2.1.0 for GitHub code scanning).

## Current limitations

- Path tracing is structural/static. A `path.long_path` signal means the graph contains a bounded route, not that runtime execution is proven.
- When traversal reaches an `unknown_dynamic` edge — or an allowed edge whose target node was never emitted into the graph — the engine degrades to `path.unknown_dynamic_handoff` instead of pretending the sink was reached.

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

- Synthetic 1000-file fixture coverage lives in `test/fixtures.test.ts`.
- All engines are pure functions on the immutable `GraphStore`; the package remains parallelizable for future tickets.

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
    path/           T25: bounded entry-to-sink path tracing
  scoring/          T14: fuseSignals() — 8-bonus formula
  output/           T15: formatHuman / formatJson
  reports/          T17-T19: writeJsonReport / writeMarkdownReport / writeSarifReport
  diff/             T24: readReport / diffReports
  cli/              T00: commander-based CLI; subcommand dispatch
```

Every engine is a pure function: `(GraphStore, EngineConfig) -> Signal[]`. All engines run on the same `GraphStore` (read-only) and their outputs are concatenated then fused by `fuseSignals`. Signal ids are SHA-256 (first 16 hex chars) of geometry+type+target+metrics — stable across runs.

## Configuration

Default config ships boundary tags for `ui`, `api`, and `persistence`, and enables all six engines with sensible defaults. The path engine can match entry/sink tags by boundary globs or boundary symbol selectors. For custom YAML, pass `--config <path>` to `scan`; the schema lives in `src/config/types.ts` and the default values live in `src/config/default.ts`.

## Schema versions

- `JsonReport.schema_version = "1.0.0"`
- `DiffReport.schema_version = "1.0.0"`
- `SARIF.version = "2.1.0"`

Bump the version on incompatible changes (per docs/01 §FR7).

## License

MIT. Part of the Hermes agent toolkit.
