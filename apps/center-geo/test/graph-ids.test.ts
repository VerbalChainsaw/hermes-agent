import { describe, it, expect } from "vitest";
import {
  makeNodeId,
  makeEdgeId,
  fileNodeId,
  normalizeId,
  type AnchorSignature,
} from "../src/graph/ids.js";

/* ── makeNodeId: determinism ────────────────────────────────────── */

describe("makeNodeId — determinism", () => {
  it("returns the same id for the same (kind, path, symbol) across calls", () => {
    const a = makeNodeId("file", "src/cli/main.ts", "");
    const b = makeNodeId("file", "src/cli/main.ts", "");
    expect(a).toBe(b);
  });

  it("returns the same id across processes (cryptographic hash)", () => {
    // Run a couple times to be sure we're not hitting a cache.
    const ids = Array.from({ length: 10 }, () =>
      makeNodeId("function", "src/a.ts", "parseConfig"),
    );
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBe(ids[0]);
    }
  });

  it("uses `<kind>:<16-hex>` format", () => {
    const id = makeNodeId("file", "src/x.ts", "");
    expect(id).toMatch(/^file:[0-9a-f]{16}$/);
  });

  it("distinguishes different kinds with the same path", () => {
    const fileNode = makeNodeId("file", "src/x.ts", "");
    const funcNode = makeNodeId("function", "src/x.ts", "main");
    expect(fileNode).not.toBe(funcNode);
    expect(fileNode.startsWith("file:")).toBe(true);
    expect(funcNode.startsWith("function:")).toBe(true);
  });

  it("distinguishes different symbols with the same path", () => {
    const a = makeNodeId("function", "src/x.ts", "foo");
    const b = makeNodeId("function", "src/x.ts", "bar");
    expect(a).not.toBe(b);
  });

  it("distinguishes different paths with the same symbol", () => {
    const a = makeNodeId("function", "src/a.ts", "main");
    const b = makeNodeId("function", "src/b.ts", "main");
    expect(a).not.toBe(b);
  });

  it("treats undefined path as empty string (so external/unknown nodes still get stable ids)", () => {
    const a = makeNodeId("external", undefined, "stripe");
    const b = makeNodeId("external", undefined, "stripe");
    expect(a).toBe(b);
    expect(a).toMatch(/^external:[0-9a-f]{16}$/);
  });

  it("treats path and undefined-path as DIFFERENT (so a relocated symbol is detectable)", () => {
    const a = makeNodeId("function", "src/a.ts", "main");
    const b = makeNodeId("function", undefined, "main");
    expect(a).not.toBe(b);
  });
});

/* ── fileNodeId ─────────────────────────────────────────────────── */

describe("fileNodeId", () => {
  it("accepts FileEntry.id format (with `file:` prefix) and returns node id", () => {
    const nodeId = fileNodeId("file:src/a.ts");
    expect(nodeId).toMatch(/^file:[0-9a-f]{16}$/);
  });

  it("accepts raw path and returns node id", () => {
    const nodeId = fileNodeId("src/a.ts");
    expect(nodeId).toMatch(/^file:[0-9a-f]{16}$/);
  });

  it("produces the SAME id for FileEntry.id and raw path with the same content", () => {
    const a = fileNodeId("file:src/a.ts");
    const b = fileNodeId("src/a.ts");
    expect(a).toBe(b);
  });
});

/* ── makeEdgeId: determinism ───────────────────────────────────── */

describe("makeEdgeId — determinism", () => {
  const from = makeNodeId("file", "src/a.ts", "");
  const to = makeNodeId("file", "src/b.ts", "");

  it("returns the same id for the same (from, to, kind, anchors)", () => {
    const anchors: AnchorSignature[] = [{ path: "src/a.ts", range: { start_line: 1, end_line: 1 } }];
    const a = makeEdgeId({ from, to, kind: "import", anchors });
    const b = makeEdgeId({ from, to, kind: "import", anchors });
    expect(a).toBe(b);
  });

  it("uses `e:<16-hex>` format", () => {
    const id = makeEdgeId({
      from,
      to,
      kind: "import",
      anchors: [{ path: "src/a.ts" }],
    });
    expect(id).toMatch(/^e:[0-9a-f]{16}$/);
  });

  it("preserves multigraph — different anchors at same from/to/kind produce different ids", () => {
    const e1 = makeEdgeId({
      from,
      to,
      kind: "import",
      anchors: [{ path: "src/a.ts", range: { start_line: 1, end_line: 1 } }],
    });
    const e2 = makeEdgeId({
      from,
      to,
      kind: "import",
      anchors: [{ path: "src/a.ts", range: { start_line: 5, end_line: 5 } }],
    });
    expect(e1).not.toBe(e2);
  });

  it("preserves multigraph — multiple anchors on one edge (re-exports) get one id", () => {
    const anchors: AnchorSignature[] = [
      { path: "src/a.ts", range: { start_line: 1, end_line: 1 } },
      { path: "src/a.ts", range: { start_line: 10, end_line: 10 } },
    ];
    const e1 = makeEdgeId({ from, to, kind: "import", anchors });
    // Re-ordering the anchors produces the SAME id (sort is stable).
    const e2 = makeEdgeId({
      from,
      to,
      kind: "import",
      anchors: [anchors[1], anchors[0]],
    });
    expect(e1).toBe(e2);
  });

  it("different edge kinds between same from/to produce different ids", () => {
    const e1 = makeEdgeId({
      from,
      to,
      kind: "import",
      anchors: [{ path: "src/a.ts" }],
    });
    const e2 = makeEdgeId({
      from,
      to,
      kind: "call",
      anchors: [{ path: "src/a.ts" }],
    });
    expect(e1).not.toBe(e2);
  });

  it("different from/to produce different ids (same kind, same anchors)", () => {
    const to2 = makeNodeId("file", "src/c.ts", "");
    const e1 = makeEdgeId({
      from,
      to,
      kind: "import",
      anchors: [{ path: "src/a.ts" }],
    });
    const e2 = makeEdgeId({
      from,
      to: to2,
      kind: "import",
      anchors: [{ path: "src/a.ts" }],
    });
    expect(e1).not.toBe(e2);
  });

  it("config-derived edges (no anchors) use configKey as tiebreaker", () => {
    const e1 = makeEdgeId({
      from,
      to,
      kind: "config",
      anchors: [],
      configKey: "ui->persistence",
    });
    const e2 = makeEdgeId({
      from,
      to,
      kind: "config",
      anchors: [],
      configKey: "ui->external",
    });
    expect(e1).not.toBe(e2);
  });

  it("configKey with same value produces same id (so two scans produce same id)", () => {
    const e1 = makeEdgeId({
      from,
      to,
      kind: "config",
      anchors: [],
      configKey: "ui->persistence",
    });
    const e2 = makeEdgeId({
      from,
      to,
      kind: "config",
      anchors: [],
      configKey: "ui->persistence",
    });
    expect(e1).toBe(e2);
  });
});

/* ── normalizeId (pass-through today) ──────────────────────────── */

describe("normalizeId", () => {
  it("returns the input unchanged", () => {
    expect(normalizeId("file:abc123")).toBe("file:abc123");
  });
});
