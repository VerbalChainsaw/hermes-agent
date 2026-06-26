import { describe, it, expect } from "vitest";
import { parseFile, extractImportsAndExports, makeToKey, parseSource } from "../src/adapters/ts/index.js";
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

/* ── makeToKey ──────────────────────────────────────────────────── */

describe("makeToKey", () => {
  it("strips leading ./ or ../", () => {
    expect(makeToKey("./foo")).toBe("foo");
    expect(makeToKey("../foo")).toBe("foo");
    expect(makeToKey("./foo/bar")).toBe("foo/bar");
  });
  it("preserves bare specifiers (external modules)", () => {
    expect(makeToKey("lodash")).toBe("lodash");
    expect(makeToKey("@org/lib")).toBe("@org/lib");
    expect(makeToKey("node:fs")).toBe("node:fs");
  });
});

/* ── import edge extraction ──────────────────────────────────────── */

describe("extractImportsAndExports — imports", () => {
  it("extracts a default import as one edge", () => {
    const source = `import foo from "./bar";\nconsole.log(foo);\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("import");
    expect(edges[0].from).toBe(fn.id);
    // The specifier's leading ./ is stripped by makeToKey (for shorter ids);
    // the original specifier is preserved in metadata.specifier.
    expect(edges[0].to).toContain("bar");
    expect(edges[0].metadata.specifier).toBe("./bar");
    expect(edges[0].confidence).toBe("high");
    expect(edges[0].anchors[0].path).toBe("src/a.ts");
  });

  it("extracts named imports", () => {
    const source = `import { a, b as c } from "./mod";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(1);
    // importedNames records the imported side (the source of truth for
    // graph identity, not the local alias). `b as c` is imported as `b`,
    // even though the local binding is `c`.
    expect(edges[0].metadata.importedNames).toEqual(["a", "b"]);
  });

  it("extracts namespace imports", () => {
    const source = `import * as ns from "./mod";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(1);
    expect(edges[0].metadata.importedNames).toEqual(["ns"]);
  });

  it("marks bare specifiers (external modules) with kind external target", () => {
    const source = `import _ from "lodash";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges[0].to.startsWith("external:")).toBe(true);
  });

  it("marks relative specifiers with kind unknown target (for graph builder to resolve)", () => {
    const source = `import _ from "./local";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges[0].to.startsWith("unknown:")).toBe(true);
  });

  it("marks node: specifiers as external", () => {
    const source = `import { readFile } from "node:fs/promises";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges[0].to.startsWith("external:")).toBe(true);
  });

  it("emits multiple edges for multiple import statements (multigraph preserved)", () => {
    const source = `
      import a from "./a";
      import b from "./b";
      import c from "./c";
    `;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(3);
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(3); // all distinct
  });

  it("two imports from the same source produce different edge ids (different anchors)", () => {
    const source = `
      import a from "./mod";
      import b from "./mod";
    `;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(2);
    expect(edges[0].id).not.toBe(edges[1].id);
    // Same target though (the spec lives at one place)
    expect(edges[0].to).toBe(edges[1].to);
  });

  it("includes the source range as evidence anchor", () => {
    const source = `import x from "./y";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges[0].anchors[0].range).toBeDefined();
    expect(edges[0].anchors[0].range?.start_line).toBe(1);
  });

  it("stores the specifier in edge metadata for downstream consumers", () => {
    const source = `import x from "./y";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges[0].metadata.specifier).toBe("./y");
  });

  it("does NOT crash on malformed input — produces diagnostics instead", () => {
    const fn = fileNode("src/a.ts");
    const result = extractImportsAndExports(fn, { type: "Garbage" });
    expect(result.edges).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === "unexpected_ast")).toBe(true);
  });
});

/* ── re-export edge extraction ──────────────────────────────────── */

describe("extractImportsAndExports — re-exports", () => {
  it("extracts `export { a } from './mod'` as a re_export edge", () => {
    const source = `export { a } from "./mod";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("re_export");
    expect(edges[0].metadata.specifier).toBe("./mod");
    expect(edges[0].metadata.reExportedNames).toEqual(["a"]);
  });

  it("extracts `export * from './mod'` as a re_export edge with all=true", () => {
    const source = `export * from "./mod";\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("re_export");
    expect(edges[0].metadata.all).toBe(true);
  });

  it("does NOT extract bare `export const x = 1` (no source)", () => {
    const source = `export const x = 1;\nexport function foo() {}\n`;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(0);
  });

  it("distinguishes re_export from import (different edge kind)", () => {
    const source = `
      import x from "./a";
      export { y } from "./b";
    `;
    const fn = fileNode("src/a.ts");
    const { edges } = extractImportsAndExports(fn, parseAst(source));
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.kind === "import")).toBeDefined();
    expect(edges.find((e) => e.kind === "re_export")).toBeDefined();
  });
});

/* ── parseFile entry point ──────────────────────────────────────── */

describe("parseFile", () => {
  it("returns AdapterSuccess on valid input", () => {
    const source = `import x from "./y";\n`;
    const result = parseFile("src/a.ts", source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileNode.path).toBe("src/a.ts");
    expect(result.edges.length).toBe(1);
  });

  it("uses the provided fileNode when given", () => {
    const source = `import x from "./y";\n`;
    const fn = fileNode("src/custom.ts");
    const result = parseFile("src/custom.ts", source, { fileNode: fn });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileNode).toBe(fn);
  });

  it("builds a default fileNode when none is provided", () => {
    const source = `export const x = 1;\n`;
    const result = parseFile("src/a.ts", source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileNode.kind).toBe("file");
    expect(result.fileNode.path).toBe("src/a.ts");
    expect(result.fileNode.id.startsWith("file:")).toBe(true);
  });

  it("returns AdapterFailure with code=syntax_error on parse failure", () => {
    // Truly malformed TS — `class {` with no body.
    const result = parseFile("src/bad.ts", "class {");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("syntax_error");
    expect(result.message).toContain("src/bad.ts");
  });

  it("never throws on weird input", () => {
    // Empty string is valid (no imports/exports).
    expect(() => parseFile("src/empty.ts", "")).not.toThrow();
    // Whitespace only is valid.
    expect(() => parseFile("src/ws.ts", "   \n\n  ")).not.toThrow();
    // Comments only is valid.
    expect(() => parseFile("src/comments.ts", "// just a comment\n")).not.toThrow();
  });

  it("reports parseMs as a positive number on success", () => {
    const result = parseFile("src/a.ts", "import x from './y';\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parseMs).toBeGreaterThanOrEqual(0);
  });
});

/* ── helper: parses source via the adapter's own parser so we test ─ */
/* ── AST shape against the real parser, not a hand-rolled mock.  ── */

function parseAst(source: string): unknown {
  // Use the SAME parser the production code uses via the public index
  // barrel — keeps the test honest and avoids runtime require() of .ts.
  return parseSource("src/test-fixture.ts", source).ast;
}
