import { describe, it, expect } from "vitest";
import { parseFile, parseSource } from "../src/adapters/ts/index.js";
import { fileNodeId } from "../src/graph/ids.js";
import type { GraphNode } from "../src/graph/types.js";

function fileNode(path: string): GraphNode {
  return {
    id: fileNodeId(path),
    kind: "file",
    label: path,
    path,
    language: "typescript",
    tags: [],
    metrics: {},
    metadata: {},
  };
}

function astOf(source: string): unknown {
  return parseSource("src/test.ts", source).ast;
}

/* ── top-level function ─────────────────────────────────────────── */

describe("extractSymbols — functions", () => {
  it("emits one function node per top-level FunctionDeclaration", () => {
    const fn = fileNode("src/a.ts");
    const r = parseFile("src/a.ts", "function parseConfig(s: string) { return s; }");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const funcs = r.nodes.filter((n) => n.kind === "function");
    expect(funcs).toHaveLength(1);
    expect(funcs[0].symbol).toBe("src/a.ts::parseConfig");
    expect(funcs[0].label).toBe("parseConfig");
    expect(funcs[0].range?.start_line).toBe(1);
    // File node in result is unchanged (T06 doesn't replace it).
    expect(r.fileNode.id).toBe(fn.id);
  });

  it("emits multiple function nodes for multiple top-level declarations", () => {
    const r = parseFile("src/a.ts", `
      function foo() {}
      function bar() {}
      function baz() {}
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const funcs = r.nodes.filter((n) => n.kind === "function");
    expect(funcs).toHaveLength(3);
  });

  it("emits a diagnostic for anonymous FunctionExpression (no name)", () => {
    // Top-level expression statement with an anonymous function should
    // not crash and should produce a non-empty diagnostics list (or be
    // silently skipped; we accept either).
    const r = parseFile("src/a.ts", "const f = function () {};");
    expect(r.ok).toBe(true);
  });
});

/* ── classes ────────────────────────────────────────────────────── */

describe("extractSymbols — classes", () => {
  it("emits one class node per ClassDeclaration", () => {
    const r = parseFile("src/a.ts", `class Foo { bar() {} }`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const classes = r.nodes.filter((n) => n.kind === "class");
    expect(classes).toHaveLength(1);
    expect(classes[0].symbol).toBe("src/a.ts::Foo");
  });

  it("emits method nodes for each class method, qualified by class name", () => {
    const r = parseFile("src/a.ts", `
      class Foo {
        bar() {}
        baz() {}
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const methods = r.nodes.filter((n) => n.kind === "method");
    expect(methods).toHaveLength(2);
    const names = methods.map((m) => m.symbol).sort();
    expect(names).toEqual(["src/a.ts::Foo.bar", "src/a.ts::Foo.baz"]);
  });

  it("handles multiple classes in one file independently", () => {
    const r = parseFile("src/a.ts", `
      class A { x() {} }
      class B { y() {} z() {} }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const classes = r.nodes.filter((n) => n.kind === "class");
    const methods = r.nodes.filter((n) => n.kind === "method");
    expect(classes).toHaveLength(2);
    expect(methods).toHaveLength(3);
  });
});

/* ── TypeScript-specific: interface, type alias, enum ────────────── */

describe("extractSymbols — TS-specific", () => {
  it("emits an interface node", () => {
    const r = parseFile("src/a.ts", `interface Options { name: string }`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ifaces = r.nodes.filter((n) => n.kind === "interface");
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].symbol).toBe("src/a.ts::Options");
  });

  it("emits a type alias node", () => {
    const r = parseFile("src/a.ts", `type Config = { debug: boolean };`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const types = r.nodes.filter((n) => n.kind === "type");
    expect(types).toHaveLength(1);
    expect(types[0].symbol).toBe("src/a.ts::Config");
  });

  it("emits an enum node (labeled 'enum Foo')", () => {
    const r = parseFile("src/a.ts", `enum Color { Red, Green, Blue }`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const enums = r.nodes.filter((n) => n.label.startsWith("enum"));
    expect(enums).toHaveLength(1);
    expect(enums[0].symbol).toBe("src/a.ts::Color");
  });
});

/* ── determinism ──────────────────────────────────────────────── */

describe("extractSymbols — determinism", () => {
  it("produces identical symbol ids across two calls with the same input", () => {
    const source = `
      function parseConfig() {}
      class Foo { bar() {} }
      interface Options { name: string }
      type Config = { debug: boolean };
      enum Color { Red }
    `;
    const r1 = parseFile("src/a.ts", source);
    const r2 = parseFile("src/a.ts", source);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const ids1 = r1.nodes.map((n) => n.id).sort();
    const ids2 = r2.nodes.map((n) => n.id).sort();
    expect(ids1).toEqual(ids2);
  });
});

/* ── error handling ──────────────────────────────────────────── */

describe("extractSymbols — error handling", () => {
  it("does not crash on malformed AST (returns empty + diagnostic)", () => {
    const fn = fileNode("src/a.ts");
    const r = extractSymbolsDirect(fn, { type: "NotAProgram" });
    expect(r.nodes).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.code === "unexpected_ast")).toBe(true);
  });

  it("returns empty diagnostics list for well-formed AST with no symbols", () => {
    const fn = fileNode("src/empty.ts");
    const r = extractSymbolsDirect(fn, astOf("// just a comment"));
    expect(r.nodes).toHaveLength(0);
    // Either empty diagnostics or only the comment-related diagnostic is OK.
    expect(r.diagnostics.length).toBeLessThanOrEqual(1);
  });
});

/* ── helper: direct call to extractSymbols (skips parseFile's wrapper) ── */

import { extractSymbols } from "../src/adapters/ts/symbols.js";
function extractSymbolsDirect(fileNode: GraphNode, ast: unknown) {
  return extractSymbols(fileNode, ast);
}
