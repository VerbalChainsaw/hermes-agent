/**
 * Shallow call/reference extraction (T07).
 *
 * Walks CallExpressions inside known symbol scopes (top-level functions
 * and class methods extracted in T06) and emits:
 *   - "call" edges for resolved calls (callee is a local symbol in this
 *     file, or a direct import specifier).
 *   - "unknown_dynamic" edges for unresolved calls (callee name visible
 *     but not bound to anything we can statically resolve).
 *   - Dynamic ImportExpressions (`import("./x")`) emit
 *     "unknown_dynamic" edges with low confidence.
 *
 * Resolution strategy (shallow — per spec):
 *   1. **Local function**: callee.name matches a top-level function or
 *      class method in the SAME file (resolved by name). High confidence.
 *   2. **Imported symbol**: callee is an identifier that matches a named
 *      import from a static ImportDeclaration. Edge goes to the import
 *      target (kind=external or kind=unknown depending on specifier).
 *      Medium confidence.
 *   3. **Dynamic / unresolvable**: callee is a CallExpression whose
 *      function part isn't a plain Identifier (e.g., `obj.method()`,
 *      `arr[i]()`, `(fn)()`), or the name doesn't match any known symbol.
 *      Edge goes to a synthetic "unknown_dynamic:<callee-name>" target.
 *      Low confidence.
 *
 * Scoping: we walk the AST once and identify all symbol declarations
 * (top-level functions + class methods) to build a name index. Then we
 * walk function bodies for CallExpressions. This is shallow — no
 * closure-capture analysis, no type-inference-based resolution. Deep
 * resolution is out of scope for the MVP.
 */

import { makeEdgeId, type AnchorSignature } from "../../graph/ids.js";
import type {
  Confidence,
  GraphEdge,
  GraphNode,
  SourceRange,
} from "../../graph/types.js";

import type { ParseDiagnostic } from "./types.js";

/* ── AST helpers (shared shape) ────────────────────────────────── */

interface TsNodeLike {
  type: string;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | null;
  range?: [number, number] | null;
  callee?: TsNodeLike | unknown;
  arguments?: unknown[];
  expression?: TsNodeLike | unknown;
  object?: TsNodeLike | unknown;
  property?: TsNodeLike | unknown;
  name?: string;
  // For MemberExpression
  computed?: boolean;
  // For ImportExpression (dynamic import)
  source?: TsNodeLike | unknown;
  // Generic pass-through for unknown fields.
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
    start_col: loc.start.column + 1,
    end_line: loc.end.line,
    end_col: loc.end.column + 1,
  };
}

/* ── symbol index built in pass 1 ───────────────────────────────── */

/**
 * Symbol table built during AST walk 1. Maps unqualified names to the
 * fully-qualified symbol id (file::Name) for local functions and
 * methods. The caller passes this index to pass 2 (call extraction).
 */
export interface SymbolIndex {
  /** Map from local name (e.g. "parseConfig") to qualified symbol id. */
  byName: Map<string, string>;
  /** Map from import specifier (e.g. "./b") to set of imported names. */
  imports: Map<string, Set<string>>;
}

/**
 * Build the symbol index for a file. Walks the AST once, collecting:
 *   - Top-level function declarations (name -> qualified id)
 *   - Import declarations (specifier -> set of imported names)
 *
 * `filePath` is required so the index maps unqualified names to ids
 * that share the same namespace as the caller (so callers and callees
 * resolve to the same `<kind>:<path>::<symbol>` form).
 *
 * Returns the index. The caller can use it to resolve callees.
 */
export function buildSymbolIndex(filePath: string, ast: unknown): SymbolIndex {
  const byName = new Map<string, string>();
  const imports = new Map<string, Set<string>>();

  if (!isTsNodeLike(ast) || ast.type !== "Program") {
    return { byName, imports };
  }
  const body = (ast as { body?: unknown[] }).body;
  if (!Array.isArray(body)) return { byName, imports };

  for (const stmt of body) {
    if (!isTsNodeLike(stmt)) continue;

    if (stmt.type === "FunctionDeclaration") {
      const name = (stmt as unknown as { id?: { name?: string } }).id?.name;
      if (name) byName.set(name, `function:${filePath}::${name}`);
    }
    if (stmt.type === "ImportDeclaration") {
      const source = (stmt as { source?: { value?: string } }).source?.value;
      const specs = (stmt as { specifiers?: unknown[] }).specifiers;
      if (source && Array.isArray(specs)) {
        const set = new Set<string>();
        for (const s of specs) {
          if (!s || typeof s !== "object") continue;
          const sp = s as { imported?: { name?: string } | null; local?: { name?: string } | null };
          const imported = sp.imported?.name;
          const local = sp.local?.name;
          if (imported) set.add(imported);
          else if (local) set.add(local);
        }
        imports.set(source, set);
      }
    }
  }

  return { byName, imports };
}

/* ── pass 2: call extraction ──────────────────────────────────── */

/**
 * Extract call edges from a parsed AST. Uses the symbol index to
 * resolve callees where possible.
 *
 * Returns:
 *   - edges: one per CallExpression (plus one per ImportExpression).
 *   - diagnostics: parse warnings (none expected from this extractor
 *     unless the AST shape is unusual).
 */
export function extractCalls(
  fileNode: GraphNode,
  ast: unknown,
  index: SymbolIndex,
): { edges: GraphEdge[]; diagnostics: ParseDiagnostic[] } {
  const edges: GraphEdge[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  if (!isTsNodeLike(ast) || ast.type !== "Program") {
    diagnostics.push({
      code: "unexpected_ast",
      message: `Expected Program AST, got ${isTsNodeLike(ast) ? ast.type : typeof ast}`,
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

    // `export function foo()` shows up as ExportNamedDeclaration with
    // a `declaration` field pointing to the FunctionDeclaration. We
    // unwrap one level so the rest of the walker sees the function
    // body directly.
    if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") {
      const inner = (stmt as { declaration?: TsNodeLike }).declaration;
      if (isTsNodeLike(inner) && inner.type === "FunctionDeclaration") {
        const name = (inner as unknown as { id?: { name?: string } }).id?.name;
        if (name) {
          const fromId = byNameIdForFunction(filePath, name);
          walkForCalls(inner.body, fromId, filePath, index, edges, diagnostics);
        }
      } else if (isTsNodeLike(inner) && inner.type === "ClassDeclaration") {
        walkClassBody(inner, filePath, index, edges, diagnostics);
      }
      continue;
    }

    if (stmt.type === "FunctionDeclaration") {
      const name = (stmt as unknown as { id?: { name?: string } }).id?.name;
      if (name) {
        const fromId = byNameIdForFunction(filePath, name);
        walkForCalls(stmt.body, fromId, filePath, index, edges, diagnostics);
      }
      continue;
    }

    if (stmt.type === "ClassDeclaration") {
      walkClassBody(stmt, filePath, index, edges, diagnostics);
      continue;
    }
  }

  return { edges, diagnostics };
}

/**
 * Walk a class body for method call sites. Extracted so the
 * `export class` form (ExportNamedDeclaration wrapping a
 * ClassDeclaration) can share the same logic as the bare form.
 */
function walkClassBody(
  classNode: TsNodeLike,
  filePath: string,
  index: SymbolIndex,
  edges: GraphEdge[],
  _diagnostics: ParseDiagnostic[],
): void {
  const className = (classNode as unknown as { id?: { name?: string } }).id?.name;
  const classBody = (classNode as unknown as { body?: { body?: unknown[] } }).body;
  if (!classBody || !Array.isArray(classBody.body)) return;
  for (const member of classBody.body) {
    if (!isTsNodeLike(member)) continue;
    if (member.type === "MethodDefinition" || member.type === "PropertyDefinition") {
      const methodName = (member as unknown as { key?: { name?: string } }).key?.name;
      if (!methodName || !className) continue;
      const fromId = methodNodeIdFor(filePath, className, methodName);
      const mBody = (member as { value?: { body?: unknown } }).value?.body;
      walkForCalls(mBody, fromId, filePath, index, edges, _diagnostics);
    }
  }
}
/* ── helpers ───────────────────────────────────────────────────── */

function methodNodeIdFor(filePath: string, className: string, methodName: string): string {
  return `method:${filePath}::${className}.${methodName}`;
}

function byNameIdForFunction(filePath: string, name: string): string {
  return `function:${filePath}::${name}`;
}

/**
 * Recursively walk a statement/expression tree and emit call edges
 * for every CallExpression encountered.
 *
 * The walker is intentionally permissive: it descends into ALL object
 * children and ALL array children of every visited node, with no
 * fixed key list. This is shallow (no semantic analysis) but it
 * guarantees we don't miss call sites that live in unexpected AST
 * positions. Performance: O(n) over the AST, each visit is O(1).
 *
 * Skip rules (to avoid infinite recursion on cyclic ASTs and to
 * avoid descending into irrelevant metadata):
 *   - Skip property `type` (visited node's own kind, no children).
 *   - Skip properties `loc` and `range` (line/col info, not code).
 *   - Skip the `parent` property (TS-ESLint sets this for traversal;
 *     following it would loop).
 */
function walkForCalls(
  node: unknown,
  fromId: string,
  filePath: string,
  index: SymbolIndex,
  edges: GraphEdge[],
  _diagnostics: ParseDiagnostic[],
): void {
  if (!isTsNodeLike(node)) return;

  // Dynamic import: `import("./x")`.
  if (node.type === "ImportExpression") {
    const src = node.source as { value?: string } | undefined;
    const specifier = src?.value ?? "<dynamic>";
    edges.push(
      buildCallEdge({
        from: fromId,
        calleeName: specifier,
        kind: "unknown_dynamic",
        confidence: "low",
        filePath,
        range: locToRange(node),
        metadata: { dynamic: true, specifier },
      }),
    );
    return;
  }

  if (node.type === "CallExpression") {
    const callee = node.callee;
    let calleeName: string | undefined;
    let kind: "call" | "unknown_dynamic" = "call";
    let confidence: Confidence = "high";

    if (isTsNodeLike(callee)) {
      if (callee.type === "Identifier") {
        calleeName = callee.name;
        // Resolve via symbol index: if the name is a local symbol, the
        // edge is "high" confidence. If it's an imported name, "medium".
        // Otherwise "low" / "unknown_dynamic".
        const localId = index.byName.get(calleeName ?? "");
        if (localId) {
          edges.push(
            buildCallEdge({
              from: fromId,
              to: localId,
              calleeName: calleeName ?? "",
              kind: "call",
              confidence: "high",
              filePath,
              range: locToRange(node),
              metadata: { resolution: "local", localId },
            }),
          );
          return;
        }
        // Check if it's a known imported name.
        for (const [specifier, names] of index.imports) {
          if (names.has(calleeName ?? "")) {
            const isRelative = specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\");
            const targetKind = isRelative ? "unknown" : "external";
            edges.push(
              buildCallEdge({
                from: fromId,
                to: `${targetKind}:${specifier}`,
                calleeName: calleeName ?? "",
                kind: "call",
                confidence: "medium",
                filePath,
                range: locToRange(node),
                metadata: { resolution: "import", specifier, importedName: calleeName },
              }),
            );
            return;
          }
        }
        // Unresolved: we know the name but can't bind it.
        kind = "unknown_dynamic";
        confidence = "low";
      } else if (callee.type === "MemberExpression") {
        // obj.method() or obj["method"]() or arr[i]() — we know the
        // method name (or string literal) but not the receiver's type.
        // Emit "unknown_dynamic" with the method name as anchor.
        let methodName: string | undefined;
        if (isTsNodeLike(callee.property) && !callee.computed) {
          methodName = (callee.property as { name?: string }).name;
        } else if (isTsNodeLike(callee.property) && callee.computed) {
          // For obj["method"]() the property is a string literal.
          const prop = callee.property as { value?: unknown };
          if (typeof prop.value === "string") methodName = prop.value;
        }
        calleeName = methodName ?? "<member>";
        kind = "unknown_dynamic";
        confidence = "low";
      } else {
        // IIFE, .call(), .bind(), tagged templates, etc.
        calleeName = "<dynamic>";
        kind = "unknown_dynamic";
        confidence = "low";
      }
    } else {
      calleeName = "<dynamic>";
      kind = "unknown_dynamic";
      confidence = "low";
    }

    edges.push(
      buildCallEdge({
        from: fromId,
        calleeName: calleeName ?? "<dynamic>",
        kind,
        confidence,
        filePath,
        range: locToRange(node),
        metadata: { resolution: "unknown" },
      }),
    );
    // Don't return — also descend into callee + arguments to catch
    // nested calls (e.g., `foo(bar())`). Walker recursion handles it.
  }

  // Permissive recursion: descend into every object/array child.
  // Skip type (visited node's own kind), loc/range (metadata), and
  // parent (TS-ESLint traversal back-reference).
  const skip = new Set(["type", "loc", "range", "parent"]);
  for (const key of Object.keys(node)) {
    if (skip.has(key)) continue;
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        walkForCalls(item, fromId, filePath, index, edges, _diagnostics);
      }
    } else if (child && typeof child === "object") {
      walkForCalls(child, fromId, filePath, index, edges, _diagnostics);
    }
  }
}

interface BuildCallEdgeInput {
  from: string;
  to?: string;
  calleeName: string;
  kind: "call" | "unknown_dynamic";
  confidence: Confidence;
  filePath: string;
  range: SourceRange | undefined;
  metadata: Record<string, unknown>;
}

function buildCallEdge(input: BuildCallEdgeInput): GraphEdge {
  const target = input.to ?? `${input.kind}:${input.calleeName ?? "<dynamic>"}`;
  const anchor: AnchorSignature = {
    path: input.filePath,
    range: input.range,
    symbol: input.calleeName ?? "<dynamic>",
  };
  return {
    id: makeEdgeId({
      from: input.from,
      to: target,
      kind: input.kind,
      anchors: [anchor],
    }),
    from: input.from,
    to: target,
    kind: input.kind,
    confidence: input.confidence,
    anchors: [
      {
        path: input.filePath,
        range: input.range,
        symbol: input.calleeName,
        source: "source",
      },
    ],
    tags: [],
    metadata: input.metadata,
  };
}
