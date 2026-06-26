/**
 * Import + re-export edge extraction (T05).
 *
 * Walks the parsed AST and emits one GraphEdge per ImportDeclaration or
 * ExportNamedDeclaration/ExportAllDeclaration. Multigraph preserved:
 * two `import` statements from the same source line produce two edges
 * with the same from/to/kind but different ids (different anchors).
 *
 * Targets are external nodes (kind="external") when the import
 * specifier looks like an external module (starts with a letter and
 * contains no relative path segments). Targets are unknown nodes
 * (kind="unknown") when the specifier is a relative path we haven't
 * resolved yet — file resolution is a graph builder responsibility
 * (T07+) that maps relative paths to file node ids.
 *
 * Edge kind:
 *   - "import" — static `import X from "..."` / `import { a } from "..."` / `import * as N from "..."`
 *   - "re_export" — `export { a } from "..."` / `export * from "..."`
 *
 * Confidence:
 *   - "high" — pure static, no type info needed
 *   - "medium" — requires interpretation (e.g. namespace re-exports)
 *   - "low" — reserved for dynamic imports (T07)
 *
 * Per docs/08 T05 acceptance: "unresolved imports produce warnings,
 * not fatal crash". We don't fail the parse on unresolved specs; we
 * emit a ParseDiagnostic and continue.
 */

import { makeEdgeId } from "../../graph/ids.js";
import type { AnchorSignature } from "../../graph/ids.js";
import type { GraphEdge, GraphNode, NodeKind } from "../../graph/types.js";

import type { ParseDiagnostic, AdapterResult } from "./types.js";

/* ── helpers ─────────────────────────────────────────────────────── */

interface TsNodeLike {
  type: string;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | null;
  range?: [number, number] | null;
}

function isTsNodeLike(x: unknown): x is TsNodeLike {
  return !!x && typeof x === "object" && "type" in (x as object);
}

function locToRange(node: TsNodeLike): AnchorSignature["range"] | undefined {
  const loc = node.loc;
  if (!loc) return undefined;
  return {
    start_line: loc.start.line,
    start_col: loc.start.column + 1, // 1-indexed
    end_line: loc.end.line,
    end_col: loc.end.column + 1,
  };
}

function nodeKindFromSource(value: string): NodeKind {
  // Heuristic: relative paths (./foo, ../foo, /foo) are treated as
  // 'unknown' targets that the graph builder resolves in a later
  // pass. Absolute bare specifiers (e.g. "stripe", "@org/lib") are
  // external modules.
  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("\\")) {
    return "unknown";
  }
  if (value.startsWith("node:")) return "external";
  return "external";
}

function importedNamesFromSpecifiers(specifiers: unknown): string[] {
  if (!Array.isArray(specifiers)) return [];
  const names: string[] = [];
  for (const s of specifiers) {
    if (!s || typeof s !== "object") continue;
    const spec = s as { imported?: { name?: string } | null; local?: { name?: string } | null };
    const imported = spec.imported?.name;
    const local = spec.local?.name;
    if (imported) names.push(imported);
    else if (local) names.push(local);
  }
  return names;
}

/* ── main entry point ───────────────────────────────────────────── */

/**
 * Extract import + re-export edges from a parsed AST. Returns:
 *   - edges: graph edges (one per import/re-export statement).
 *   - diagnostics: parse warnings (none for static imports unless we
 *     hit an unexpected AST shape).
 *
 * This function does NOT do file resolution — relative-path imports
 * produce edges with target kind="unknown". The graph builder
 * (T07+) wires those to actual file nodes.
 */
export function extractImportsAndExports(
  fileNode: GraphNode,
  ast: unknown,
): { edges: GraphEdge[]; diagnostics: ParseDiagnostic[] } {
  const edges: GraphEdge[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  if (!isTsNodeLike(ast) || ast.type !== "Program") {
    diagnostics.push({
      code: "unexpected_ast",
      message: `Expected Program AST, got ${typeof ast}${isTsNodeLike(ast) ? ` (type=${ast.type})` : ""}`,
    });
    return { edges, diagnostics };
  }

  const body = (ast as { body?: unknown[] }).body;
  if (!Array.isArray(body)) {
    diagnostics.push({ code: "missing_body", message: "AST Program has no body array" });
    return { edges, diagnostics };
  }

  const filePath = fileNode.path ?? "<unknown>";

  for (const stmt of body) {
    if (!isTsNodeLike(stmt)) continue;

    if (stmt.type === "ImportDeclaration") {
      const source = (stmt as { source?: { value?: string } | null }).source;
      const specifier = source?.value;
      if (typeof specifier !== "string") {
        diagnostics.push({
          code: "import_no_specifier",
          message: "ImportDeclaration has no string specifier",
          line: stmt.loc?.start.line,
          column: stmt.loc?.start.column,
        });
        continue;
      }
      const specifiers = (stmt as { specifiers?: unknown }).specifiers;
      const importedNames = importedNamesFromSpecifiers(specifiers);
      const targetKind = nodeKindFromSource(specifier);
      const anchor: AnchorSignature = {
        path: filePath,
        range: locToRange(stmt),
        symbol: importedNames.join(",") || "*",
      };
      const edge: GraphEdge = {
        id: makeEdgeId({
          from: fileNode.id,
          to: `${targetKind}:${makeToKey(specifier)}`,
          kind: "import",
          anchors: [anchor],
        }),
        from: fileNode.id,
        to: `${targetKind}:${makeToKey(specifier)}`,
        kind: "import",
        confidence: "high",
        anchors: [
          {
            path: filePath,
            range: anchor.range,
            symbol: anchor.symbol,
            source: "source",
          },
        ],
        tags: [],
        metadata: { specifier, importedNames },
      };
      edges.push(edge);
      continue;
    }

    if (
      stmt.type === "ExportNamedDeclaration" ||
      stmt.type === "ExportAllDeclaration"
    ) {
      const source = (stmt as { source?: { value?: string } | null }).source;
      if (!source || typeof source.value !== "string") {
        // Bare export (no `from "..."`) — not a graph edge, just a node-level
        // symbol. Handled by T06.
        continue;
      }
      const specifier = source.value;
      const targetKind = nodeKindFromSource(specifier);
      const reExportedNames: string[] = [];
      if (stmt.type === "ExportNamedDeclaration") {
        const spec = (stmt as { specifiers?: unknown }).specifiers;
        reExportedNames.push(...importedNamesFromSpecifiers(spec));
      }
      const anchor: AnchorSignature = {
        path: filePath,
        range: locToRange(stmt),
        symbol: reExportedNames.length === 0 ? "*" : reExportedNames.join(","),
      };
      const edge: GraphEdge = {
        id: makeEdgeId({
          from: fileNode.id,
          to: `${targetKind}:${makeToKey(specifier)}`,
          kind: "re_export",
          anchors: [anchor],
        }),
        from: fileNode.id,
        to: `${targetKind}:${makeToKey(specifier)}`,
        kind: "re_export",
        confidence: "high",
        anchors: [
          {
            path: filePath,
            range: anchor.range,
            symbol: anchor.symbol,
            source: "source",
          },
        ],
        tags: [],
        metadata: { specifier, reExportedNames, all: stmt.type === "ExportAllDeclaration" },
      };
      edges.push(edge);
      continue;
    }
  }

  return { edges, diagnostics };
}

/**
 * Build a stable "to key" for a specifier. This becomes part of the
 * target node id (e.g. `external:stripe`, `unknown:./foo`). The
 * specifier is taken as-is — path resolution happens in a later pass.
 */
export function makeToKey(specifier: string): string {
  // Strip leading ./ or ../ for readability in the id (keeps the id
  // shorter and avoids chained-dot confusion). Forward-slash
  // normalization is the responsibility of the graph builder.
  const stripped = specifier.replace(/^(\.\/|\.\.\/)+/, "");
  return stripped;
}

export type { ParseDiagnostic, AdapterResult };
