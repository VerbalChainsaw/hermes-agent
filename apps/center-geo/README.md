# @hermes/center-geo

> **Status: T00 (package skeleton).** Builds, runs, smoke-tests pass. No
> real scanning yet — lands across tickets T01–T30.

`center-geo` is **CENTER-MULTIGEOMETRY**: a deterministic multi-geometry
structural risk scanner for codebases. It is a **companion to
[`center-audit`](../../skills/center-audit)**, not a replacement.

`center-audit` is strong when you already have a specific suspected
defect and a center anchor. `center-geo` answers the question that
comes *before* you have a center:

- Where in the codebase are the high-risk structural regions?
- Which nodes, edges, paths, or boundaries deserve attention?
- What does the codebase look like under multiple graph traversal
  geometries — radial, cycle, boundary, anomaly, convergent?

It emits **evidence-backed risk hypotheses** with anchors. It does not
prove defects. Run `center-audit` afterward to prove or disprove a
specific candidate.

## Status

| Ticket | Status | Notes |
|--|--|--|
| T00 | done | Package skeleton, CLI handles `--help`/`--version`/stub subcommands |
| T01 | pending | Config loader + validator |
| T02+ | pending | File enumerator, graph types, TS/JS adapter, engines |

See `docs/08-implementation-tickets.md` in the requirements package
for the full ticket list.

## Develop

```sh
# from this directory:
npm install
npm run build
npm test
npm run dev -- --help    # run CLI directly from source via tsx
```

## Architecture

```
Repository Snapshot
  -> Config Loader              (T01)
  -> File Enumerator            (T02)
  -> Language Adapters          (T05+)
  -> Graph Builder              (T03-T04)
  -> Graph Store                (T04)
  -> Geometry Engine Registry   (T08+)
  -> Signal Store               (T14+)
  -> Fusion Engine              (T15-T16)
  -> Report Writers             (T17-T19)
```

Every stage is deterministic. No code execution is required for graph
extraction. See `docs/01-product-requirements.md` in the requirements
package for the full contract.

## Hard rules (from the requirements package)

- **No confirmed defect labels.** Hypotheses require external proof.
- **No automatic code repair.** Repair is a separate audit step.
- **No mandatory LLM dependency.** Graph extraction is deterministic.
- **No secret exposure.** Report excerpts redact known secret patterns.
- **No code execution during indexing.** Static extraction only.
