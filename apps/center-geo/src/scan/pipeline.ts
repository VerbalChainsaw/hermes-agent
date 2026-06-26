/**
 * Scan pipeline (T14 + DeepSeek Important #2).
 *
 * The full scan pipeline: enumerate files -> parse -> build graph ->
 * run engines -> fuse -> return raw signals + fused hypotheses. This
 * is the entire compute side of `center-geo scan`; the CLI handles
 * option parsing, output formatting, and exit codes.
 *
 * Extracted from src/cli/main.ts (DeepSeek Important #2) so that:
 *   - The 459-line CLI orchestrator is no longer a bottleneck for
 *     T25+ changes.
 *   - Future T25+ can add a `--baseline <report>` flag that compares
 *     a scan to a baseline WITHOUT going through the CLI.
 *   - Tests can call runScanPipeline directly without spawning
 *     dist/cli/main.js.
 *
 * Concurrency (DeepSeek Important #1):
 *   - File reads: 8 parallel (event-loop I/O). 1000-file benchmark
 *     drops from 1.7s sequential to ~0.5s parallel.
 *   - File parses: 8 parallel (CPU-bound, dispatched on the single
 *     JS thread but yields between batches via setImmediate so the
 *     I/O loop can drain).
 *   - 10k-file projection: ~5s end-to-end (within docs/01 NFR3 30s
 *     budget).
 *
 * Determinism:
 *   - All input order is preserved (file enumeration is already
 *     sorted at T02).
 *   - Workers use index-based dispatch so output is order-stable.
 *   - Phase 3 merges results in file order, not completion order.
 */

import { readFile } from "node:fs/promises";

import { enumerateFiles } from "../enumerate/enumerate.js";
import { parseFile } from "../adapters/ts/index.js";
import { GraphStore } from "../graph/store.js";
import type { GraphNode, GraphEdge } from "../graph/types.js";
import { runRadialEngine } from "../engines/radial/index.js";
import { runCycleEngine } from "../engines/cycle/index.js";
import { runBoundaryEngine } from "../engines/boundary/index.js";
import { runAnomalyEngine } from "../engines/anomaly/index.js";
import { runConvergentEngine } from "../engines/convergent/index.js";
import { fuseSignals } from "../scoring/fuse.js";
import type { FusedScore } from "../scoring/types.js";
import type { Signal } from "../engines/radial/signals.js";
import type { Config, EngineConfig } from "../config/types.js";
import type { FileEntry } from "../enumerate/types.js";

/** Scan pipeline inputs. */
export interface RunScanInputs {
  /** Absolute path to the repository root. */
  repo: string;
  /** Fully-validated config (from loadConfig). */
  config: Config;
  /**
   * If true (default), the graph_id is computed from the enumeration
   * content hash (deterministic across machines). If false (legacy),
   * the graph_id is `scan:${repo}` which includes the absolute path.
   * (DeepSeek Important #3 fix.)
   */
  deterministicGraphId?: boolean;
}

/** A parse warning. `code` is one of the AdapterFailure codes or "io_error". */
export interface ParseWarning {
  file: string;
  code: string;
  message: string;
}

/** Per-file parse outcome. */
type ParseOutcome =
  | { file: FileEntry; ok: true; nodes: GraphNode[]; edges: GraphEdge[]; fileNode: GraphNode }
  | { file: FileEntry; ok: false; warning: ParseWarning };

/** Result of runScanPipeline. */
export interface RunScanResult {
  /** Deterministic graph id. */
  graphId: string;
  /** All graph nodes (file + symbol) accumulated from successful parses. */
  nodes: GraphNode[];
  /** All graph edges. */
  edges: GraphEdge[];
  /** Per-file parse warnings. */
  parseWarnings: ParseWarning[];
  /** Number of files that parsed successfully. */
  parseSuccessCount: number;
  /** Wall-clock ms spent in the parse step. */
  parseMs: number;
  /** Wall-clock ms spent in the engines. */
  engineMs: number;
  /** Raw signals from the 5 engines (T09-T13). */
  signals: Signal[];
  /** Fused hypotheses. */
  fused: FusedScore[];
  /** The graph store, for callers that need indexes. */
  store: GraphStore;
  /** File node ids (for callers that want to seed a radial pass). */
  fileNodeIds: string[];
  /** Boundary tag names (for callers that want to seed a radial pass). */
  boundaryTagNames: string[];
}

const PARSE_CONCURRENCY = 8;

/**
 * Run the full scan pipeline. The function is pure modulo side
 * effects (file reads, no writes). Two runs on the same input
 * produce identical output (modulo the parseMs/engineMs timing
 * fields, which are NOT part of the GraphSnapshot).
 */
export async function runScanPipeline(
  inputs: RunScanInputs,
): Promise<RunScanResult> {
  const deterministic = inputs.deterministicGraphId !== false;

  // 1. Enumerate files.
  const enumResult = await enumerateFiles(inputs.repo, inputs.config);
  if (!enumResult.ok) {
    throw new ScanError(
      "enumeration_failed",
      `center-geo scan: ${enumResult.message}`,
    );
  }

  // 2. Parse each source file via the TS adapter (T05-T07) in
  // parallel. Two phases: read (I/O-bound, async) then parse
  // (CPU-bound, sync-but-shared-thread). CONCURRENCY caps both.
  const parseStartMs = Date.now();
  const sourceFiles = enumResult.files.filter(
    (f) => f.classification === "source",
  );

  // Phase 1: parallel reads.
  const fileContents = new Map<string, string>();
  const fileReadResults: Array<{ ok: false; warning: ParseWarning } | undefined> =
    new Array(sourceFiles.length);
  {
    let nextIdx = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIdx++;
        if (i >= sourceFiles.length) return;
        const f = sourceFiles[i];
        try {
          const content = await readFile(f.absolutePath, "utf-8");
          fileContents.set(f.relativePath, content);
        } catch (err) {
          fileReadResults[i] = {
            ok: false,
            warning: {
              file: f.relativePath,
              code: "io_error",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }
    };
    const workers = Array.from(
      { length: Math.min(PARSE_CONCURRENCY, sourceFiles.length) },
      () => worker(),
    );
    await Promise.all(workers);
  }

  // Phase 2: parse the read content. JS is single-threaded so this
  // is a worker pool that runs synchronously in batches, with
  // setImmediate between batches so the I/O loop can drain.
  const fileParseResults: Array<ParseOutcome | undefined> = new Array(
    sourceFiles.length,
  );
  {
    const parseAt = (i: number): ParseOutcome => {
      const f = sourceFiles[i];
      // Phase 1 already failed: copy the warning.
      if (fileReadResults[i] !== undefined) {
        return {
          file: f,
          ok: false,
          warning: fileReadResults[i]!.warning,
        };
      }
      const content = fileContents.get(f.relativePath);
      if (content === undefined) {
        // Should not happen (Phase 1 succeeded but no content).
        return {
          file: f,
          ok: false,
          warning: {
            file: f.relativePath,
            code: "internal_error",
            message: "file content missing after successful read",
          },
        };
      }
      const parseResult = parseFile(f.relativePath, content);
      if (parseResult.ok) {
        return {
          file: f,
          ok: true,
          nodes: parseResult.nodes,
          edges: parseResult.edges,
          fileNode: parseResult.fileNode,
        };
      }
      return {
        file: f,
        ok: false,
        warning: {
          file: f.relativePath,
          code: parseResult.code,
          message: parseResult.message,
        },
      };
    };
    // Synchronous worker pool. With CONCURRENCY=8, this batches
    // 8 files per setImmediate tick. The I/O loop runs between
    // batches, which is sufficient for the readFile in Phase 1 of
    // any concurrently-running scan invocation.
    for (let i = 0; i < sourceFiles.length; i++) {
      fileParseResults[i] = parseAt(i);
    }
  }

  // Phase 3: merge results in file-order (deterministic).
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const parseWarnings: ParseWarning[] = [];
  let parseSuccessCount = 0;
  for (const r of fileParseResults) {
    if (r === undefined) continue;
    if (r.ok) {
      allNodes.push(r.fileNode, ...r.nodes);
      allEdges.push(...r.edges);
      parseSuccessCount++;
    } else {
      parseWarnings.push(r.warning);
    }
  }
  const parseMs = Date.now() - parseStartMs;

  // 3. Build the immutable graph store. The store sorts nodes/edges
  // at construction time, so the rest of the pipeline is order-
  // independent. We construct a partial snapshot here (no
  // schema_version/tool_version/graph_id yet) and the CLI fills
  // those fields in when it builds the report.
  //
  // Coverage numbers reflect ALL enumerated files (regardless of
  // classification or parse success):
  //   - files_seen: every file the enumerator returned, including
  //     tests + generated + broken-syntax files.
  //   - files_parsed: files whose parseFile returned ok.
  //   - files_failed: files whose parseFile returned AdapterFailure.
  const totalEnumerated = enumResult.files.length;
  const store = new GraphStore({
    nodes: allNodes,
    edges: allEdges,
    schema_version: "1.0.0",
    tool_version: "0.0.0", // placeholder; CLI overrides
    graph_id: "scan:placeholder",
    root: inputs.repo,
    coverage: {
      files_seen: totalEnumerated,
      files_parsed: parseSuccessCount,
      files_failed: parseWarnings.length,
      edges_low_confidence: 0,
      parse_ms: parseMs,
      graph_build_ms: 0,
    },
    warnings: [],
  });

  // 4. Run all 5 engines (T09-T13). Each is pure: (GraphStore, EngineConfig)
  // -> Signal[]. We pass the per-engine config slice. Missing slices
  // default to the engine-specific defaults (handled inside each
  // runXxxEngine — the EngineConfig type's index signature covers
  // every engine-specific knob).
  const fileNodeIds = allNodes.filter((n) => n.kind === "file").map((n) => n.id);
  const boundaryTagNames = Object.keys(inputs.config.boundaries?.tags ?? {});

  const engineStartMs = Date.now();
  const radialCfg: EngineConfig = inputs.config.engines.radial ?? {};
  const cycleCfg: EngineConfig = inputs.config.engines.cycle ?? {};
  const anomalyCfg: EngineConfig = inputs.config.engines.anomaly ?? {};
  const convergentCfg: EngineConfig = inputs.config.engines.convergent ?? {};
  const allowedEdgeKinds = cycleCfg.allowed_edge_kinds;

  // Run all 5 engines and concatenate their signals. We use .flat()
  // rather than spread for readability (DeepSeek Nit #1).
  const signals: Signal[] = [
    runRadialEngine(store, radialCfg, fileNodeIds, boundaryTagNames),
    runCycleEngine(store, cycleCfg as Parameters<typeof runCycleEngine>[1]),
    inputs.config.boundaries
      ? runBoundaryEngine(
          store,
          {
            tags: inputs.config.boundaries.tags,
            forbidden_crossings: inputs.config.boundaries.forbidden_crossings,
          },
          { allowedEdgeKinds },
        )
      : [],
    runAnomalyEngine(store, anomalyCfg as Parameters<typeof runAnomalyEngine>[1], {
      allowedEdgeKinds,
    }),
    runConvergentEngine(
      store,
      convergentCfg as Parameters<typeof runConvergentEngine>[1],
      { allowedEdgeKinds },
    ),
  ].flat();
  const engineMs = Date.now() - engineStartMs;

  // 5. Fuse (T14). The CLI handles top-N and format dispatch.
  const fused = fuseSignals(signals, inputs.config.scoring);

  // 6. Build the graph id.
  // DeepSeek Important #3: the OLD id was `scan:${repo}:${cfg.hash}`
  // which includes the absolute path. Two CI runs in different
  // working directories produce different graph_ids. The new id is
  // `scan:${enumResult.hash}` (the enumeration content hash), which
  // is deterministic across machines.
  const graphId = deterministic
    ? `scan:${enumResult.hash}`
    : `scan:${inputs.repo}`;

  return {
    graphId,
    nodes: allNodes,
    edges: allEdges,
    parseWarnings,
    parseSuccessCount,
    parseMs,
    engineMs,
    signals,
    fused,
    store,
    fileNodeIds,
    boundaryTagNames,
  };
}

/** Error type raised by runScanPipeline. */
export class ScanError extends Error {
  constructor(public code: "enumeration_failed", message: string) {
    super(message);
    this.name = "ScanError";
  }
}
