import { describe, it, expect } from "vitest";
import { parseFile, parseSource } from "../src/adapters/ts/index.js";
import { fileNodeId } from "../src/graph/ids.js";
import type { GraphEdge, GraphNode } from "../src/graph/types.js";

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

function callEdges(result: ReturnType<typeof parseFile>): GraphEdge[] {
  if (!result.ok) return [];
  return result.edges.filter((e) => e.kind === "call" || e.kind === "unknown_dynamic");
}

/* ── local call resolution ──────────────────────────────────────── */

describe("extractCalls — local function calls", () => {
  it("emits a high-confidence call edge when callee is a local function", () => {
    const r = parseFile("src/a.ts", `
      function helper(x: number) { return x; }
      export function main() {
        return helper(42);
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("call");
    expect(calls[0].confidence).toBe("high");
    // Resolves to a function symbol id.
    expect(calls[0].to).toContain("function:");
    // From should be the caller function.
    expect(calls[0].from).toContain("function:");
  });

  it("uses the emitted symbol node ids for local caller/callee edges", () => {
    const r = parseFile("src/a.ts", `
      function helper(x: number) { return x; }
      export function main() {
        return helper(42);
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls).toHaveLength(1);
    const helperNode = r.nodes.find((node) => node.kind === "function" && node.symbol?.endsWith("::helper"));
    const mainNode = r.nodes.find((node) => node.kind === "function" && node.symbol?.endsWith("::main"));
    expect(helperNode).toBeTruthy();
    expect(mainNode).toBeTruthy();
    expect(calls[0].to).toBe(helperNode?.id);
    expect(calls[0].from).toBe(mainNode?.id);
  });

  it("emits multiple edges for multiple call sites in one function", () => {
    const r = parseFile("src/a.ts", `
      function a() {}
      function b() {}
      function c() {}
      function main() {
        a(); b(); c();
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBe(3);
  });
});

/* ── imported call resolution ─────────────────────────────────── */

describe("extractCalls — imported-symbol calls", () => {
  it("emits a medium-confidence call edge for an imported function", () => {
    const r = parseFile("src/a.ts", `
      import { readFile } from "./reader";
      export function load() {
        return readFile("x");
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBe(1);
    expect(calls[0].confidence).toBe("medium");
    expect(calls[0].metadata.resolution).toBe("import");
    expect(calls[0].metadata.specifier).toBe("./reader");
    // External target: relative paths get "unknown" kind prefix.
    expect(calls[0].to).toContain("reader");
  });

  it("emits an external target for bare specifier (non-relative)", () => {
    const r = parseFile("src/a.ts", `
      import { foo } from "lodash";
      export function main() { return foo(); }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].to.startsWith("external:")).toBe(true);
    expect(calls[0].to).toContain("lodash");
  });
});

/* ── unknown_dynamic resolution ───────────────────────────────── */

describe("extractCalls — unresolved / dynamic", () => {
  it("emits an unknown_dynamic edge for member calls (obj.method())", () => {
    const r = parseFile("src/a.ts", `
      export function main(obj: { foo: () => void }) {
        obj.foo();
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("unknown_dynamic");
    expect(calls[0].confidence).toBe("low");
  });

  it("emits an unknown_dynamic edge for computed access (obj['foo']())", () => {
    const r = parseFile("src/a.ts", `
      export function main(obj: any) {
        obj["foo"]();
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("unknown_dynamic");
  });

  it("emits an unknown_dynamic edge for dynamic import", () => {
    const r = parseFile("src/a.ts", `
      export async function main() {
        const m = await import("./lazy");
        return m;
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("unknown_dynamic");
    expect(calls[0].metadata.dynamic).toBe(true);
  });
});

/* ── method calls ─────────────────────────────────────────────── */

describe("extractCalls — class method bodies", () => {
  it("emits a call edge from a method body (caller is the method)", () => {
    const r = parseFile("src/a.ts", `
      function helper() {}
      class Foo {
        bar() {
          helper();
        }
      }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBe(1);
    const methodNode = r.nodes.find((node) => node.kind === "method" && node.symbol?.endsWith("::Foo.bar"));
    expect(methodNode).toBeTruthy();
    // Caller is the method, not the class.
    expect(calls[0].from).toBe(methodNode?.id);
    expect(calls[0].from).toContain("method:");
  });
});

/* ── error handling ──────────────────────────────────────────── */

describe("extractCalls — error handling", () => {
  it("does not crash on malformed AST", () => {
    // parseFile catches syntax errors at the parse stage, returning
    // AdapterFailure. extractCalls is only called when AST is valid.
    // Verify that path.
    const r = parseFile("src/a.ts", "class {");
    expect(r.ok).toBe(false);
  });

  it("returns empty call list when there are no call expressions", () => {
    const r = parseFile("src/a.ts", "export const x = 1;");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(callEdges(r)).toHaveLength(0);
  });
});

/* ── determinism ──────────────────────────────────────────────── */

describe("extractCalls — determinism", () => {
  it("produces identical call edges across two parses of the same source", () => {
    const source = `
      function a() {}
      function b() {}
      import { c } from "./c";
      export function main() {
        a();
        b();
        c();
      }
    `;
    const r1 = parseFile("src/a.ts", source);
    const r2 = parseFile("src/a.ts", source);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const ids1 = callEdges(r1).map((e) => e.id).sort();
    const ids2 = callEdges(r2).map((e) => e.id).sort();
    expect(ids1).toEqual(ids2);
  });
});

/* ── anchor presence ──────────────────────────────────────────── */

describe("extractCalls — anchor presence", () => {
  it("every call edge has at least one anchor pointing to the call site", () => {
    const r = parseFile("src/a.ts", `
      function a() {}
      export function main() { a(); }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = callEdges(r);
    expect(calls.length).toBeGreaterThan(0);
    for (const e of calls) {
      expect(e.anchors.length).toBeGreaterThan(0);
      expect(e.anchors[0].path).toBe("src/a.ts");
      expect(e.anchors[0].source).toBe("source");
    }
  });
});
