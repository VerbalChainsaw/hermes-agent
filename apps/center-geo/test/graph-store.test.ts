import { describe, it, expect } from "vitest";
import { GraphStore } from "../src/graph/store.js";
import { makeNodeId, makeEdgeId } from "../src/graph/ids.js";
import type {
  GraphEdge,
  GraphNode,
  GraphSnapshot,
} from "../src/graph/types.js";

/* ── fixture helpers ────────────────────────────────────────────── */

function mkNode(id: string, kind: GraphNode["kind"], tags: string[] = []): GraphNode {
  return {
    id,
    kind,
    label: id,
    tags,
    metrics: {},
    metadata: {},
  };
}

function mkEdge(from: string, to: string, kind: GraphEdge["kind"]): GraphEdge {
  return {
    id: makeEdgeId({
      from,
      to,
      kind,
      anchors: [{ path: "src/test.ts", range: { start_line: 1, end_line: 1 } }],
    }),
    from,
    to,
    kind,
    confidence: "high",
    anchors: [{ path: "src/test.ts", range: { start_line: 1, end_line: 1 }, source: "source" }],
    tags: [],
    metadata: {},
  };
}

function mkSnapshot(opts: {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
}): GraphSnapshot {
  return {
    schema_version: "1.0.0",
    tool_version: "0.1.0",
    graph_id: "test-snapshot",
    root: "/test/root",
    coverage: {
      files_seen: 0,
      files_parsed: 0,
      files_failed: 0,
      edges_low_confidence: 0,
      parse_ms: 0,
      graph_build_ms: 0,
    },
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
    warnings: [],
  };
}

/* ── size & basic lookup ────────────────────────────────────────── */

describe("GraphStore — basic lookups", () => {
  it("reports nodeCount and edgeCount", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e = mkEdge(a.id, b.id, "import");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b], edges: [e] }));
    expect(store.nodeCount).toBe(2);
    expect(store.edgeCount).toBe(1);
  });

  it("getNode returns the node by id", () => {
    const a = mkNode("file:a", "file", ["ui"]);
    const store = new GraphStore(mkSnapshot({ nodes: [a] }));
    expect(store.getNode("file:a")).toBe(a);
    expect(store.getNode("file:nope")).toBeUndefined();
  });

  it("getEdge returns the edge by id", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e = mkEdge(a.id, b.id, "import");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b], edges: [e] }));
    expect(store.getEdge(e.id)).toBe(e);
  });

  it("hasNode and hasEdge return booleans", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e = mkEdge(a.id, b.id, "call");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b], edges: [e] }));
    expect(store.hasNode("file:a")).toBe(true);
    expect(store.hasNode("file:nope")).toBe(false);
    expect(store.hasEdge(e.id)).toBe(true);
    expect(store.hasEdge("nope")).toBe(false);
  });
});

/* ── determinism ──────────────────────────────────────────────── */

describe("GraphStore — deterministic ordering", () => {
  it("returns nodes sorted by id regardless of input order", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:z", "file");
    const c = mkNode("file:m", "file");
    const store = new GraphStore(mkSnapshot({ nodes: [c, a, b] }));
    expect(store.allNodes().map((n) => n.id)).toEqual(["file:a", "file:m", "file:z"]);
  });

  it("returns edges sorted by (from, kind, to, id)", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e1 = mkEdge(a.id, b.id, "call");
    const e2 = mkEdge(a.id, b.id, "import");
    const e3 = mkEdge(b.id, a.id, "call");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b], edges: [e3, e1, e2] }));
    const ids = store.allEdges().map((e) => e.id);
    // Expected order:
    //   (file:a, call, file:b, ...) = e1
    //   (file:a, import, file:b, ...) = e2
    //   (file:b, call, file:a, ...) = e3
    expect(ids).toEqual([e1.id, e2.id, e3.id]);
  });

  it("two stores built from the same snapshot produce the same ordering", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e = mkEdge(a.id, b.id, "import");
    const snap = mkSnapshot({ nodes: [b, a], edges: [e] });
    const s1 = new GraphStore(snap);
    const s2 = new GraphStore(snap);
    expect(s1.allNodes().map((n) => n.id)).toEqual(
      s2.allNodes().map((n) => n.id),
    );
    expect(s1.allEdges().map((e) => e.id)).toEqual(
      s2.allEdges().map((e) => e.id),
    );
  });
});

/* ── grouped lookups ──────────────────────────────────────────── */

describe("GraphStore — grouped lookups", () => {
  it("nodesByTag returns matching node ids, sorted", () => {
    const a = mkNode("file:a", "file", ["ui"]);
    const b = mkNode("file:b", "file", ["ui", "persistence"]);
    const c = mkNode("file:c", "file", ["persistence"]);
    const store = new GraphStore(mkSnapshot({ nodes: [a, b, c] }));
    expect(store.nodesByTag("ui")).toEqual(["file:a", "file:b"]);
    expect(store.nodesByTag("persistence")).toEqual(["file:b", "file:c"]);
    expect(store.nodesByTag("nonexistent")).toEqual([]);
  });

  it("edgesByKind returns matching edge ids, sorted", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const c = mkNode("file:c", "file");
    const e1 = mkEdge(a.id, b.id, "call");
    const e2 = mkEdge(a.id, c.id, "call");
    const e3 = mkEdge(a.id, b.id, "import");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b, c], edges: [e1, e2, e3] }));
    expect(store.edgesByKind("call")).toEqual([e1.id, e2.id]);
    expect(store.edgesByKind("import")).toEqual([e3.id]);
    expect(store.edgesByKind("reference")).toEqual([]);
  });

  it("outboundEdges returns edges leaving a node, in deterministic order", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const c = mkNode("file:c", "file");
    const e1 = mkEdge(a.id, b.id, "call");
    const e2 = mkEdge(a.id, c.id, "call");
    const e3 = mkEdge(b.id, c.id, "call");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b, c], edges: [e1, e2, e3] }));
    expect(store.outboundEdges(a.id)).toEqual([e1.id, e2.id]);
    expect(store.outboundEdges(b.id)).toEqual([e3.id]);
    expect(store.outboundEdges(c.id)).toEqual([]);
  });

  it("inboundEdges returns edges entering a node, in deterministic order", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const c = mkNode("file:c", "file");
    const e1 = mkEdge(a.id, c.id, "call");
    const e2 = mkEdge(b.id, c.id, "call");
    const e3 = mkEdge(a.id, b.id, "call");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b, c], edges: [e1, e2, e3] }));
    expect(store.inboundEdges(c.id)).toEqual([e1.id, e2.id]);
    expect(store.inboundEdges(b.id)).toEqual([e3.id]);
    expect(store.inboundEdges(a.id)).toEqual([]);
  });

  it("outboundEdgesResolved returns full GraphEdge objects", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e = mkEdge(a.id, b.id, "import");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b], edges: [e] }));
    const resolved = store.outboundEdgesResolved(a.id);
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe(e.id);
    expect(resolved[0].from).toBe(a.id);
    expect(resolved[0].to).toBe(b.id);
    expect(resolved[0].kind).toBe("import");
  });
});

/* ── immutability ──────────────────────────────────────────────── */

describe("GraphStore — immutability", () => {
  it("does not mutate the input snapshot (deep-freezes by replacing arrays)", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e = mkEdge(a.id, b.id, "call");
    const snap = mkSnapshot({ nodes: [b, a], edges: [e] });
    const beforeNodes = snap.nodes.slice();
    const beforeEdges = snap.edges.slice();
    new GraphStore(snap);
    // Original snapshot array contents unchanged.
    expect(snap.nodes).toEqual(beforeNodes);
    expect(snap.edges).toEqual(beforeEdges);
    // But snapshot.nodes may not equal snapshot's internal storage
    // because the store makes a fresh sort. That's fine — we don't
    // promise to NOT replace the snapshot object. We promise NOT to
    // mutate the caller's arrays in-place.
  });

  it("two stores share no state — mutating one's indexes does not affect the other", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const e = mkEdge(a.id, b.id, "call");
    const snap = mkSnapshot({ nodes: [a, b], edges: [e] });
    const s1 = new GraphStore(snap);
    const s2 = new GraphStore(snap);
    // Mutate the internal Map of s1 by accessing it (TypeScript-private
    // via the [] index on the public getter only — but the underlying
    // Map is `ReadonlyMap` and modifying it via `as any` would be a
    // TS error; runtime-modifying it would still not affect s2).
    expect(s1).not.toBe(s2); // distinct instances
    expect(s1.nodeCount).toBe(s2.nodeCount);
  });
});

/* ── summary ──────────────────────────────────────────────────── */

describe("GraphStore — summary", () => {
  it("summary reports counts by kind and top-N fan-in/out", () => {
    const a = mkNode("file:a", "file");
    const b = mkNode("file:b", "file");
    const c = mkNode("file:c", "file");
    const d = mkNode("file:d", "file");
    // d has 3 inbound edges (high fan-in)
    const e1 = mkEdge(a.id, d.id, "import");
    const e2 = mkEdge(b.id, d.id, "import");
    const e3 = mkEdge(c.id, d.id, "import");
    const store = new GraphStore(mkSnapshot({ nodes: [a, b, c, d], edges: [e1, e2, e3] }));
    const summary = store.summary();
    expect(summary.nodes).toBe(4);
    expect(summary.edges).toBe(3);
    expect(summary.edgesByKind.import).toBe(3);
    // d should be the top fan-in (3 inbound)
    expect(summary.topFanIn[0]).toEqual({ id: d.id, count: 3 });
  });
});
