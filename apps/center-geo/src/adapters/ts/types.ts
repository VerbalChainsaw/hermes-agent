/**
 * Adapter types — shared by the TS/JS adapter (T05-T07).
 *
 * AdapterResult is the unit the parser returns. It's a discriminated
 * union so callers can branch on `result.ok` cleanly. On failure we
 * include enough diagnostic info to surface a useful warning in the
 * graph snapshot (per the spec: "unresolved imports produce warnings,
 * not fatal crash").
 */

import type { GraphEdge, GraphNode } from "../../graph/index.js";

export interface ParseDiagnostic {
  /** Stable code (e.g. "import_unresolved", "syntax_error"). */
  code: string;
  message: string;
  /** 1-indexed line where the issue was detected. Optional. */
  line?: number;
  /** 1-indexed column. Optional. */
  column?: number;
}

export interface AdapterSuccess {
  ok: true;
  /** The file-level node (one per parsed file). */
  fileNode: GraphNode;
  /** Edges from this file to other nodes (imports, re-exports, calls — T07). */
  edges: GraphEdge[];
  /** Per-file parse warnings (e.g. unresolved imports). */
  diagnostics: ParseDiagnostic[];
  /** Parse wall-clock time in ms. */
  parseMs: number;
}

export interface AdapterFailure {
  ok: false;
  /** Top-level failure code; converted to a GraphWarning downstream. */
  code: "syntax_error" | "io_error" | "internal_error";
  message: string;
  diagnostics: ParseDiagnostic[];
}

export type AdapterResult = AdapterSuccess | AdapterFailure;
