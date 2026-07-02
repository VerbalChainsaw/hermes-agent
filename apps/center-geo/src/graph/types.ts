/**
 * Graph types.
 *
 * Mirrors schemas/graph.schema.json from the requirements package.
 * The schema is the source of truth for required fields and enums;
 * if you change the schema, change this file and the snapshot
 * validator (T03+ — graph schema validation is a separate concern).
 *
 * Design constraints (from docs/01 §FR3):
 *   - Multigraph: multiple edges between the same (from, to) pair
 *     are preserved. Each edge has its own id and confidence.
 *   - Determinism: same source code → same node ids, same edge ids,
 *     same edge order. This is what makes diff (T24) work.
 *   - Evidence anchors: every edge carries anchors pointing back to
 *     the source code location that produced it. A signal without
 *     an anchor is not a signal — it's a guess.
 */

/* ── primitives ─────────────────────────────────────────────────── */

/**
 * 1-indexed line/column range in a source file. Columns are 1-indexed
 * UTF-16 code units (matches how editors and LSP servers count).
 */
export interface SourceRange {
  /** 1-indexed line where the symbol/edge starts. */
  start_line: number;
  /** 1-indexed column where the symbol/edge starts. Optional (some emitters skip column data). */
  start_col?: number;
  /** 1-indexed line where the symbol/edge ends. */
  end_line: number;
  /** 1-indexed column where the symbol/edge ends. */
  end_col?: number;
}

/**
 * Source provenance for an edge anchor. The "source" enum is the
 * evidence category — a config-derived edge and a static-call-derived
 * edge have different confidence defaults.
 */
export type AnchorSource = "source" | "config" | "trace" | "git" | "generated" | "manual";

/**
 * Evidence anchor: points to a specific source location that produced
 * (or justifies) the edge. Multiple anchors per edge are allowed
 * (e.g. "imports A and re-exports B" → two anchors).
 */
export interface Anchor {
  /** Repo-relative POSIX path to the source file. */
  path: string;
  /** Source range within the file (line/column). Optional for config/traced edges. */
  range?: SourceRange;
  /** Symbol name within the file (e.g. "parseConfig", "default"). Optional. */
  symbol?: string;
  /** SHA-256 hash of the relevant source excerpt, lowercase hex. Optional. */
  excerpt_hash?: string;
  /** Revision (git sha or scan timestamp) when the anchor was recorded. Optional. */
  revision?: string;
  /** Provenance category. */
  source: AnchorSource;
}

/**
 * Confidence level. From highest to lowest: "high" (resolved static
 * call), "medium" (resolved via direct import + naming convention),
 * "low" (unresolved dynamic), "unknown" (no information).
 */
export type Confidence = "unknown" | "low" | "medium" | "high";

/* ── nodes ──────────────────────────────────────────────────────── */

/**
 * Node kind: what kind of graph entity this represents.
 *
 * - "file": source file (one per included path).
 * - "function": top-level function declaration.
 * - "method": class method.
 * - "class": class declaration.
 * - "interface": TypeScript interface (treated as a graph node, not just type info).
 * - "type": TypeScript type alias.
 * - "module": re-exported module identifier (e.g. `import * as foo from "./bar"`).
 * - "route": URL route handler (when applicable).
 * - "schema": data schema (JSON Schema, Zod, etc.).
 * - "test": test file or test case (when distinguishable).
 * - "state": state key / store entry.
 * - "event": event topic / pub-sub channel.
 * - "external": external system (out of repo).
 * - "unknown": no information (placeholder for unparsed nodes).
 */
export type NodeKind =
  | "file"
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "module"
  | "route"
  | "schema"
  | "test"
  | "state"
  | "event"
  | "external"
  | "unknown";

export interface GraphNode {
  /** Stable id (format defined in ids.ts). */
  id: string;
  /** Node kind. */
  kind: NodeKind;
  /** Display label. */
  label: string;
  /** Optional repo-relative POSIX path (always present for kind=file, often for others). */
  path?: string;
  /** Source language (e.g. "typescript", "javascript"). Optional. */
  language?: string;
  /** Symbol name within the file. Optional. */
  symbol?: string;
  /** Source range. Optional (only meaningful when path is set). */
  range?: SourceRange;
  /** Tags for boundary classification and fusion (e.g. "ui", "persistence", "test"). */
  tags: string[];
  /** Numeric metrics (LOC, fan-in, fan-out, etc.). Open-ended shape; engines add fields as needed. */
  metrics: Record<string, number>;
  /** Free-form metadata for adapter-specific data. */
  metadata: Record<string, unknown>;
}

/* ── edges ──────────────────────────────────────────────────────── */

/**
 * Edge kind: what kind of relationship this represents.
 *
 * - "import": static ES-module import.
 * - "re_export": `export ... from "..."`.
 * - "call": direct function/method call.
 * - "reference": non-call reference (e.g. type reference, identifier).
 * - "state_read" / "state_write": read/write of a state key.
 * - "event_publish" / "event_subscribe": pub/sub relationship.
 * - "test_of": edge from test node to system-under-test.
 * - "config": edge derived from configuration (boundary, mapping).
 * - "unknown_dynamic": dynamic reference that couldn't be resolved.
 * - "external_call": call to an external system.
 */
export type EdgeKind =
  | "import"
  | "re_export"
  | "call"
  | "reference"
  | "state_read"
  | "state_write"
  | "event_publish"
  | "event_subscribe"
  | "test_of"
  | "config"
  | "unknown_dynamic"
  | "external_call";

export interface GraphEdge {
  /** Stable id (format defined in ids.ts). */
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Relationship kind. */
  kind: EdgeKind;
  /** Confidence level (see Confidence type). */
  confidence: Confidence;
  /** Evidence anchors — at least one is required for any emitted edge. */
  anchors: Anchor[];
  /** Tags for boundary classification (e.g. "ui->persistence"). */
  tags: string[];
  /** Free-form metadata. */
  metadata: Record<string, unknown>;
}

/* ── snapshot ──────────────────────────────────────────────────── */

/**
 * Parse coverage summary. Tracks how much of the source code we
 * successfully indexed vs what we skipped.
 */
export interface CoverageStats {
  /** Number of files enumerated (matches EnumerationResult.files.length). */
  files_seen: number;
  /** Number of files fully parsed into the graph. */
  files_parsed: number;
  /** Number of files indexed into the graph snapshot. */
  files_indexed: number;
  /** Number of files skipped from indexing (generated/test/non-source/etc.). */
  files_skipped: number;
  /** Number of files that failed to parse (recorded in warnings). */
  files_failed: number;
  /** Total graph node count. */
  nodes_total: number;
  /** Total graph edge count. */
  edges_total: number;
  /** Number of unsupported files encountered during enumeration/indexing. */
  unsupported_files: number;
  /** Number of generated files encountered during enumeration/indexing. */
  generated_files: number;
  /** Repo-relative paths that failed parsing. */
  parse_failure_paths: string[];
  /** Number of edges with confidence "unknown" or "low". */
  edges_low_confidence: number;
  /** Total parse time in ms (across all adapters). */
  parse_ms: number;
  /** Total graph build time in ms. */
  graph_build_ms: number;
}

export interface RevisionInfo {
  vcs: "git" | "none" | "unknown";
  commit?: string;
  branch?: string;
  dirty?: boolean;
  baseline_commit?: string;
  snapshot_hash?: string;
}

/**
 * Warning emitted during graph construction. Same shape as
 * EnumerationWarning but with a severity enum per the schema.
 */
export interface GraphWarning {
  code: string;
  message: string;
  path?: string;
  severity: "info" | "warning" | "error";
}

/**
 * Snapshot of the graph at a point in time. The full payload T09+
 * emits as `graph.json`.
 *
 * Invariants (enforced by the type system + tests):
 *   - Every edge.from / edge.to refers to a node.id in `nodes`.
 *   - multigraph: no de-duplication of edges; same (from, to, kind)
 *     can appear multiple times if they come from different anchors.
 *   - Deterministic: nodes and edges are stored in the same sorted
 *     order they would be emitted as JSON.
 */
export interface GraphSnapshot {
  /** Schema version this snapshot conforms to. Currently "1.0.0". */
  schema_version: string;
  /** Tool version that produced this snapshot (from package.json). */
  tool_version: string;
  /** Stable id of this specific snapshot. */
  graph_id: string;
  /** ISO-8601 timestamp of creation (omitted in CI mode per FR11). */
  created_at?: string;
  /** Repo root the snapshot was built from (absolute path). */
  root: string;
  /** Revision metadata or deterministic snapshot hash fallback. */
  revision: RevisionInfo;
  /** Deterministic hash of the resolved config used for the scan. */
  config_hash: string;
  /** Parse coverage summary. */
  coverage: CoverageStats;
  /** All nodes, deduplicated by id. Sorted by id for determinism. */
  nodes: GraphNode[];
  /** All edges. Sorted by (from, kind, to, id) for determinism. Multigraph preserved. */
  edges: GraphEdge[];
  /** Build warnings. */
  warnings: GraphWarning[];
}
