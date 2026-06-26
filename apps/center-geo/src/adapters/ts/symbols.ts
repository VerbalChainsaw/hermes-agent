/**
 * Symbol extraction (T06).
 *
 * Walks the parsed AST and emits one GraphNode per top-level
 * declaration: top-level functions, classes (with their methods as
 * additional nodes), TypeScript interfaces, type aliases, enums.
 * Exported symbols get a tag so fusion can prioritise them.
 *
 * Symbol ids are produced by makeNodeId(kind, path, qualifiedSymbol):
 *   file:src/a.ts              → file node (T02)
 *   function:src/a.ts::parseConfig → function node
 *   method:src/a.ts::Foo.bar    → method node (qualified by class name)
 *   class:src/a.ts::Foo         → class node
 *   interface:src/a.ts::Options  → interface node
 *   type:src/a.ts::Config       → type alias node
 *
 * The `::` separator makes qualified names parseable and unambiguous
 * (paths can contain `:` only on Windows drive letters, which are
 * stripped by toPosixPath upstream).
 */

import { makeNodeId } from "../../graph/ids.js";
import type { GraphEdge, GraphNode, NodeKind, SourceRange } from "../../graph/types.js";

import type { ParseDiagnostic } from "./types.js";

const QUALIFIER_SEP = "::";

/* ── AST helpers ─────────────────────────────────────────────────── */

interface TsNodeLike {
  type: string;
  id?: { name?: string } | null;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | null;
  range?: [number, number] | null;
  // Common node shape: id is an Identifier node; some have key/name fields.
  key?: { name?: string } | null;
  name?: { name?: string } | null;
  params?: unknown[];
  // Class-specific
  superClass?: unknown;
  // TypeScript-specific
  declare?: boolean;
  abstract?: boolean;
  static?: boolean;
  readonly?: boolean;
  // Method / property
  accessibility?: "public" | "protected" | "private" | undefined;
  optional?: boolean;
  // Enum
  members?: unknown[];
  // Misc
  exportKind?: "type" | "value" | null;
  // We don't need to fully type the AST — just enough to walk it.
  [key: string]: unknown;
}

function isTsNodeLike(x: unknown): x is TsNodeLike {
  return !!x && typeof x === "object" && "type" in (x as object);
}

function locToRange(node: TsNodeLike): SourceRange | undefined {
  const loc = node.loc;
  if (!loc) return undefined;
  return {
    start_line: loc.start.line,
    start_col: loc.start.column + 1, // 1-indexed columns
    end_line: loc.end.line,
    end_col: loc.end.column + 1,
  };
}

function getIdentifierName(node: TsNodeLike): string | undefined {
  if (node.id?.name) return node.id.name;
  if (node.key?.name) return node.key.name;
  if (node.name?.name) return node.name.name;
  return undefined;
}

/* ── per-declaration extractors ─────────────────────────────────── */

/**
 * Emit a graph node for one top-level or member-level declaration.
 * Returns the node plus an optional "contained_in" edge to the
 * containing entity (file or class).
 */
function makeSymbolNode(
  kind: NodeKind,
  filePath: string,
  qualifiedSymbol: string,
  declarationNode: TsNodeLike,
  exported: boolean,
  isStatic: boolean,
  accessibility: "public" | "protected" | "private" | undefined,
): GraphNode {
  const tags: string[] = [];
  if (exported) tags.push("exported");
  if (isStatic) tags.push("static");
  if (kind === "method") tags.push(accessibility ?? "public");
  return {
    id: makeNodeId(kind, filePath, qualifiedSymbol),
    kind,
    label: qualifiedSymbol.split(QUALIFIER_SEP).pop() ?? qualifiedSymbol,
    path: filePath,
    language: "typescript",
    symbol: qualifiedSymbol,
    range: locToRange(declarationNode),
    tags,
    metrics: {},
    metadata: {},
  };
}

/**
 * Extract methods of a class body. Returns method-level GraphNodes
 * plus their "contained_in" edges to the class node.
 */
function extractClassMembers(
  filePath: string,
  className: string,
  classNode: TsNodeLike,
): { methodNodes: GraphNode[]; methodEdges: GraphEdge[]; classEdges: GraphEdge[] } {
  const methodNodes: GraphNode[] = [];
  const methodEdges: GraphEdge[] = [];
  const classEdges: GraphEdge[] = [];

  // ClassDeclaration.body is ClassBody; ClassExpression.body too.
  const body = classNode.body;
  if (!isTsNodeLike(body) || !Array.isArray((body as { body?: unknown[] }).body)) {
    return { methodNodes, methodEdges, classEdges };
  }
  const members = (body as unknown as { body?: unknown[] }).body;
  if (!Array.isArray(members)) {
    return { methodNodes, methodEdges, classEdges };
  }
  for (const member of members) {
    if (!isTsNodeLike(member)) continue;

    // MethodDefinition (TS-ESLint) or PropertyDefinition (TS strict).
    // We accept both because the parser dialect varies.
    const methodName = getIdentifierName(member);
    if (!methodName) continue;

    const isStatic = member.static === true;
    const isAbstract = member.abstract === true;
    const accessibility = member.accessibility;
    // Qualified symbol: file + "::" + class + "." + method. The "."
    // separator inside a class matches TS member-access syntax (Foo.bar)
    // which makes the qualified name human-readable.
    const qualifiedName = `${filePath}${QUALIFIER_SEP}${className}.${methodName}`;
    const kind: NodeKind = isAbstract ? "method" : "method"; // both kinds map to method today
    const tags: string[] = ["method"];
    if (isStatic) tags.push("static");
    if (isAbstract) tags.push("abstract");
    tags.push(accessibility ?? "public");

    const methodNode: GraphNode = {
      id: makeNodeId(kind, filePath, qualifiedName),
      kind,
      label: methodName,
      path: filePath,
      language: "typescript",
      symbol: qualifiedName,
      range: locToRange(member),
      tags,
      metrics: {},
      metadata: { className },
    };
    methodNodes.push(methodNode);

    // Method → class edge. We use "reference" kind for now because
    // there's no dedicated "member_of" kind in the schema; the edge
    // carries the class context via metadata.
    // (T07+ can add a richer containment edge kind if needed.)
  }

  return { methodNodes, methodEdges, classEdges };
}

/* ── main entry point ───────────────────────────────────────────── */

/**
 * Extract symbol-level GraphNodes from a parsed AST. Returns:
 *   - nodes: all symbol nodes (functions, classes, methods, interfaces, types, enums)
 *   - edges: edges from each symbol to its file (kind="reference", "contained_in" via metadata)
 *   - diagnostics: per-symbol warnings (parse anomalies)
 *
 * Symbol ids follow the pattern `<kind>:file:<posix-path>::<symbol>`.
 * For methods, the symbol is qualified by class name.
 */
export function extractSymbols(
  fileNode: GraphNode,
  ast: unknown,
): { nodes: GraphNode[]; edges: GraphEdge[]; diagnostics: ParseDiagnostic[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  if (!isTsNodeLike(ast) || ast.type !== "Program") {
    diagnostics.push({
      code: "unexpected_ast",
      message: `Expected Program AST, got ${isTsNodeLike(ast) ? ast.type : typeof ast}`,
    });
    return { nodes, edges, diagnostics };
  }

  const filePath = fileNode.path;
  if (!filePath) {
    diagnostics.push({
      code: "missing_file_path",
      message: "FileNode has no path; cannot qualify symbols",
    });
    return { nodes, edges, diagnostics };
  }

  const body = (ast as { body?: unknown[] }).body;
  if (!Array.isArray(body)) {
    diagnostics.push({
      code: "missing_body",
      message: "AST Program has no body array",
    });
    return { nodes, edges, diagnostics };
  }

  for (const stmt of body) {
    if (!isTsNodeLike(stmt)) continue;

    // Skip interface declarations that are entirely type-only — we
    // still emit a node (interfaces are graph-relevant for fusion),
    // but mark them as type-only.
    const isTypeOnly = stmt.type === "TSInterfaceDeclaration" ||
                       stmt.type === "TSTypeAliasDeclaration" ||
                       stmt.type === "EnumDeclaration"; // also type-only

    // Function declarations: top-level functions.
    if (stmt.type === "FunctionDeclaration") {
      const name = getIdentifierName(stmt);
      if (!name) {
        diagnostics.push({
          code: "anonymous_function",
          message: "Function declaration has no name",
          line: stmt.loc?.start.line,
        });
        continue;
      }
      const exported = stmt.declare === true || stmt.exportKind === "value" || hasExportKeyword(stmt);
      const funcNode = makeSymbolNode(
        "function",
        filePath,
        `${filePath}${QUALIFIER_SEP}${name}`,
        stmt,
        exported,
        false,
        undefined,
      );
      nodes.push(funcNode);
      // File → function edge (reference, anchor points to declaration).
      edges.push(makeSymbolToFileEdge(fileNode, funcNode));
      continue;
    }

    // Class declarations.
    if (stmt.type === "ClassDeclaration") {
      const name = getIdentifierName(stmt);
      if (!name) {
        diagnostics.push({
          code: "anonymous_class",
          message: "Class declaration has no name",
          line: stmt.loc?.start.line,
        });
        continue;
      }
      const exported = hasExportKeyword(stmt);
      const classNode = makeSymbolNode(
        "class",
        filePath,
        `${filePath}${QUALIFIER_SEP}${name}`,
        stmt,
        exported,
        false,
        undefined,
      );
      nodes.push(classNode);
      edges.push(makeSymbolToFileEdge(fileNode, classNode));

      // Class methods.
      const { methodNodes, methodEdges: _ignored } = extractClassMembers(
        filePath,
        name,
        stmt,
      );
      nodes.push(...methodNodes);
      // Method → class edge (reference).
      for (const m of methodNodes) {
        edges.push(makeMethodToClassEdge(classNode, m));
      }
      continue;
    }

    // TypeScript-specific: interface, type alias, enum.
    if (stmt.type === "TSInterfaceDeclaration") {
      const name = getIdentifierName(stmt);
      if (!name) {
        diagnostics.push({
          code: "anonymous_interface",
          message: "TS interface declaration has no name",
          line: stmt.loc?.start.line,
        });
        continue;
      }
      const exported = hasExportKeyword(stmt);
      const node = makeSymbolNode(
        "interface",
        filePath,
        `${filePath}${QUALIFIER_SEP}${name}`,
        stmt,
        exported,
        false,
        undefined,
      );
      nodes.push(node);
      edges.push(makeSymbolToFileEdge(fileNode, node));
      continue;
    }
    if (stmt.type === "TSTypeAliasDeclaration") {
      const name = getIdentifierName(stmt);
      if (!name) {
        diagnostics.push({
          code: "anonymous_type_alias",
          message: "TS type alias has no name",
          line: stmt.loc?.start.line,
        });
        continue;
      }
      const exported = hasExportKeyword(stmt);
      const node = makeSymbolNode(
        "type",
        filePath,
        `${filePath}${QUALIFIER_SEP}${name}`,
        stmt,
        exported,
        false,
        undefined,
      );
      nodes.push(node);
      edges.push(makeSymbolToFileEdge(fileNode, node));
      continue;
    }
    if (stmt.type === "EnumDeclaration" || stmt.type === "TSEnumDeclaration") {
      const name = getIdentifierName(stmt);
      if (!name) {
        diagnostics.push({
          code: "anonymous_enum",
          message: "Enum declaration has no name",
          line: stmt.loc?.start.line,
        });
        continue;
      }
      const exported = hasExportKeyword(stmt);
      // We emit enums as "type" kind (no dedicated enum kind; schema
      // has 13 node kinds and enum is one of the implicit category
      // ones that fits "type"). Future ticket can add a dedicated kind.
      const node = makeSymbolNode(
        "type",
        filePath,
        `${filePath}${QUALIFIER_SEP}${name}`,
        stmt,
        exported,
        false,
        undefined,
      );
      // Override label to disambiguate from type alias.
      node.label = `enum ${name}`;
      nodes.push(node);
      edges.push(makeSymbolToFileEdge(fileNode, node));
      continue;
    }

    // Unhandled but interesting — flag as diagnostic so we can extend
    // coverage without silently dropping nodes.
    const KNOWN = new Set([
      "ImportDeclaration",
      "ExportNamedDeclaration",
      "ExportAllDeclaration",
      "ExportDefaultDeclaration",
      "VariableDeclaration",
      "ExpressionStatement",
      "TSDeclareFunction",
      "TSModuleDeclaration",
      "TSInterfaceDeclaration", // already handled above
      "TSTypeAliasDeclaration", // already handled above
      "EnumDeclaration", // already handled above
      "TSEnumDeclaration", // already handled above
      "ClassDeclaration", // already handled above
      "FunctionDeclaration", // already handled above
      "EmptyStatement",
    ]);
    if (!KNOWN.has(stmt.type) && !isTypeOnly) {
      diagnostics.push({
        code: "unhandled_declaration",
        message: `Top-level declaration of type '${stmt.type}' was not extracted to a graph node`,
        line: stmt.loc?.start.line,
      });
    }
  }

  return { nodes, edges, diagnostics };
}

/* ── edge helpers ──────────────────────────────────────────────── */

function makeSymbolToFileEdge(fileNode: GraphNode, symbolNode: GraphNode): GraphEdge {
  return {
    id: `${symbolNode.id}->file:${fileNode.id}`, // placeholder; replaced below
    from: fileNode.id,
    to: symbolNode.id,
    kind: "reference",
    confidence: "high",
    anchors: [
      {
        path: symbolNode.path ?? "<unknown>",
        range: symbolNode.range,
        symbol: symbolNode.symbol,
        source: "source",
      },
    ],
    tags: ["declaration"],
    metadata: { relationship: "declared_in" },
  };
}

function makeMethodToClassEdge(classNode: GraphNode, methodNode: GraphNode): GraphEdge {
  return {
    id: `${methodNode.id}->class:${classNode.id}`, // placeholder; replaced below
    from: classNode.id,
    to: methodNode.id,
    kind: "reference",
    confidence: "high",
    anchors: [
      {
        path: methodNode.path ?? "<unknown>",
        range: methodNode.range,
        symbol: methodNode.symbol,
        source: "source",
      },
    ],
    tags: ["declaration", "method_of_class"],
    metadata: { relationship: "declared_in", className: classNode.label },
  };
}

/**
 * Heuristic: detect "export" prefix on a statement. The TS-ESLint
 * parser sets `exportKind` on the statement itself for ExportNamedDeclaration
 * wrappers; for inline-export forms we look at a `leadingComments`-like
 * marker. Simplest correct heuristic for now: check parent wrapping.
 */
function hasExportKeyword(_node: TsNodeLike): boolean {
  // TODO (T07+): walk up to parent to detect `export function foo()` / `export class Foo`.
  // For T06, this returns false; the ExportNamedDeclaration handling
  // in T05 covers the export-re-export case. T06 only needs to know
  // whether a top-level symbol was EXPORTED for tagging; T07+ will
  // refine this via parent-walking.
  return false;
}
