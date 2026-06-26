/**
 * TypeScript / JavaScript adapter entry point.
 *
 * T05 lands here. T06 (symbol extraction) and T07 (call extraction)
 * will hook into the same parseFile entry; each extends AdapterResult
 * with additional edges/nodes as their tickets land.
 *
 * Scope of T05 (this file):
 *   - parseFile(filePath, source, fileNode) -> AdapterResult
 *   - Always emits the file-level GraphNode (fileNode parameter).
 *   - Extracts import + re-export edges via imports.ts.
 *   - Reports per-file parse diagnostics; never fatal.
 */

import { fileNodeId } from "../../graph/ids.js";
import type {
  AnchorSignature,
} from "../../graph/ids.js";
import type { GraphNode, NodeKind } from "../../graph/types.js";

import { parseSource } from "./parser.js";
import { extractImportsAndExports } from "./imports.js";
import { extractSymbols } from "./symbols.js";
import type {
  AdapterFailure,
  AdapterResult,
  AdapterSuccess,
  ParseDiagnostic,
} from "./types.js";

export interface ParseFileOptions {
  /**
   * The file-level node. T05 doesn't generate this; the graph builder
   * (T07+) constructs it before calling parseFile. If omitted, the
   * adapter builds a default file node from `filePath`.
   */
  fileNode?: GraphNode;
}

/**
 * Build a default file-level node for the given path. Used when the
 * graph builder hasn't pre-constructed one (early T05 standalone
 * tests, for instance).
 */
function defaultFileNode(filePath: string): GraphNode {
  const id = fileNodeId(filePath);
  return {
    id,
    kind: "file",
    label: filePath,
    path: filePath,
    language: filePath.endsWith(".ts") || filePath.endsWith(".tsx") ? "typescript" : "javascript",
    tags: [],
    metrics: {},
    metadata: {},
  };
}

/**
 * T06 lands symbol nodes inside AdapterSuccess.nodes. We extend the
 * AdapterSuccess type via a local intersection so the field is optional
 * (only present when parseFile ran successfully). Callers that want
 * the symbol nodes read `result.nodes` directly.
 */
export type ParseFileSuccess = AdapterSuccess & {
  /** T06+ symbol nodes extracted from this file. Empty array for files with no symbols. */
  nodes: GraphNode[];
};

/**
 * Parse a single source file and extract T05's edges (imports +
 * re-exports) and T06's symbol nodes.
 *
 * Returns AdapterResult. On parse failure, returns AdapterFailure
 * with a synthetic diagnostic — the graph builder downstream turns
 * this into a GraphWarning so the scan continues.
 *
 * Per T05 acceptance: "unresolved imports produce warnings, not fatal
 * crash". We classify unresolved imports by their specifier shape
 * (relative vs bare) and mark the edge accordingly; the graph builder
 * is responsible for resolving relative specs to file nodes later.
 */
export function parseFile(
  filePath: string,
  source: string,
  options: ParseFileOptions = {},
): ParseFileSuccess | AdapterFailure {
  const fileNode = options.fileNode ?? defaultFileNode(filePath);
  const diagnostics: ParseDiagnostic[] = [];

  let parsed;
  try {
    parsed = parseSource(filePath, source);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const failure: AdapterFailure = {
      ok: false,
      code: "syntax_error",
      message: `Parse failed for ${filePath}: ${reason}`,
      diagnostics: [{ code: "syntax_error", message: reason }],
    };
    return failure;
  }

  const { edges, diagnostics: importDiags } = extractImportsAndExports(fileNode, parsed.ast);
  diagnostics.push(...importDiags);

  // T06: extract symbol-level nodes (functions, classes, methods, interfaces, types, enums).
  // Symbols are emitted as additional nodes; the import edges we already have
  // are unrelated to symbols (different concern).
  const { nodes: symbolNodes, edges: symbolEdges, diagnostics: symbolDiags } =
    extractSymbols(fileNode, parsed.ast);
  diagnostics.push(...symbolDiags);

  const success: AdapterSuccess = {
    ok: true,
    fileNode,
    edges: [...edges, ...symbolEdges],
    diagnostics,
    parseMs: parsed.parseMs,
  };
  return { ...success, nodes: symbolNodes };
}

export { extractImportsAndExports, makeToKey } from "./imports.js";
export { parseSource } from "./parser.js";
export type { AdapterResult, AdapterSuccess, AdapterFailure, ParseDiagnostic };
export type { AnchorSignature, GraphNode, NodeKind };
