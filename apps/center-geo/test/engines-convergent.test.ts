import { describe, it, expect } from "vitest";
import { GraphStore, makeEdgeId } from "../src/graph/index.js";
import { runConvergentEngine } from "../src/engines/convergent/index.js";
import type { GraphEdge, GraphNode, GraphSnapshot } from "../src/graph/types.js";
import type { ConvergentEngineConfig } from "../src/engines/convergent/index.js";

/* ── helpers ─────────────────────────────────────────────────────── */

function node(id: string, path: string, kind: GraphNode["kind"] = "file"): GraphNode {
  return { id, kind, label: path, path, tags: [], metrics: {}, metadata: {} };
}

function edge(from: string, to: string, kind: GraphEdge["kind"] = "import"): GraphEdge {
  return {
    id: makeEdgeId({ from, to, kind, anchors: [] }),
    from, to, kind,
    confidence: "high",
    anchors: [],
    tags: [],
    metadata: {},
  };
}

function mkSnapshot(opts: { nodes?: GraphNode[]; edges?: GraphEdge[] }): GraphSnapshot {
  return {
    schema_version: "1.0.0",
    tool_version: "0.1.0",
    graph_id: "t",
    root: "/",
    coverage: {
      files_seen: 0, files_parsed: 0, files_failed: 0,
      edges_low_confidence: 0, parse_ms: 0, graph_build_ms: 0,
    },
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
    warnings: [],
  };
}

const baseConfig: ConvergentEngineConfig = {
  enabled: true,
  convergent_min_branches: 3,
};

/* ── config gate ───────────────────────────────────────────────── */

describe("runConvergentEngine — config gate", () => {
  it("returns empty when enabled=false", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "d"), edge("b", "d"), edge("c", "d")],
    }));
    const r = runConvergentEngine(store, { enabled: false });
    expect(r).toEqual([]);
  });

  it("returns empty when graph has no file nodes", () => {
    const sym = (id: string): GraphNode => ({ id, kind: "function", label: id, tags: [], metrics: {}, metadata: {} });
    const store = new GraphStore(mkSnapshot({
      nodes: [sym("a"), sym("b"), sym("c")],
      edges: [edge("a", "b"), edge("c", "b")],
    }));
    const r = runConvergentEngine(store, baseConfig);
    expect(r).toEqual([]);
  });
});

/* ── basic detection ────────────────────────────────────────────── */

describe("runConvergentEngine — basic detection", () => {
  it("emits a convergent_target for a node with 3+ upstream branches", () => {
    // a, b, c all import d. With min_branches=3, d is convergent.
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "d"), edge("b", "d"), edge("c", "d")],
    }));
    const r = runConvergentEngine(store, baseConfig);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("convergent_target");
    expect(r[0].geometryId).toBe("convergent");
    expect(r[0].targetId).toBe("d");
    expect(r[0].metrics.branchCount).toBe(3);
    expect(r[0].metadata.branchSources.sort()).toEqual(["a", "b", "c"]);
  });

  it("does NOT emit a signal when upstream count is below min_branches", () => {
    // a, b import d. With min_branches=3, d is NOT convergent.
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "d"), edge("b", "d")],
    }));
    const r = runConvergentEngine(store, baseConfig);
    expect(r).toEqual([]);
  });

  it("does NOT emit a signal for a leaf node with no upstream branches", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "b")], // b has 1 upstream, c has 0
    }));
    const r = runConvergentEngine(store, baseConfig);
    expect(r).toEqual([]);
  });
});

/* ── threshold semantics ──────────────────────────────────────── */

describe("runConvergentEngine — threshold semantics", () => {
  it("honors a custom convergent_min_branches", () => {
    // 4 nodes all import a center. min_branches=2 → flags center.
    // 4 nodes all import a center. min_branches=5 → no flag.
    const nodes = ["a", "b", "c", "d", "center"].map((id) => node(id, `src/${id}.ts`));
    const edges = [
      edge("a", "center"), edge("b", "center"),
      edge("c", "center"), edge("d", "center"),
    ];
    const store = new GraphStore(mkSnapshot({ nodes, edges }));

    const r1 = runConvergentEngine(store, { enabled: true, convergent_min_branches: 2 });
    expect(r1).toHaveLength(1);
    expect(r1[0].targetId).toBe("center");
    expect(r1[0].metrics.branchCount).toBe(4);

    const r2 = runConvergentEngine(store, { enabled: true, convergent_min_branches: 5 });
    expect(r2).toEqual([]);
  });

  it("default min_branches = 3 (3 upstream triggers)", () => {
    // 3 nodes all import a center. Default 3 should flag.
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "center"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "center"), edge("b", "center"), edge("c", "center")],
    }));
    const r = runConvergentEngine(store, { enabled: true });
    expect(r).toHaveLength(1);
    expect(r[0].targetId).toBe("center");
  });
});

/* ── self-loop edge case ──────────────────────────────────────── */

describe("runConvergentEngine — self-loops", () => {
  it("does NOT count the target as its own upstream branch", () => {
    // a imports center. center has a self-loop. The self-loop should
    // NOT count center as its own upstream branch.
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "center"].map((id) => node(id, `src/${id}.ts`)),
      edges: [
        edge("a", "center"), edge("b", "center"),
        edge("center", "center"), // self-loop
      ],
    }));
    // 2 distinct upstream (a, b) + 1 self-loop ignored. branchCount = 2.
    // min_branches=3 → no flag.
    const r = runConvergentEngine(store, baseConfig);
    expect(r).toEqual([]);
  });
});

/* ── allowed_edge_kinds filter ─────────────────────────────────── */

describe("runConvergentEngine — allowed_edge_kinds", () => {
  it("respects allowed_edge_kinds (skips disallowed kinds)", () => {
    // 4 nodes. a, b, c each have a 'call' edge to center. Only 'import'
    // is allowed, so center has 0 imports → not convergent.
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "center"].map((id) => node(id, `src/${id}.ts`)),
      edges: [
        edge("a", "center", "call"),
        edge("b", "center", "call"),
        edge("c", "center", "call"),
      ],
    }));
    const r1 = runConvergentEngine(store, baseConfig, { allowedEdgeKinds: ["import"] });
    expect(r1).toEqual([]);

    const r2 = runConvergentEngine(store, baseConfig, { allowedEdgeKinds: ["call"] });
    // 3 call edges, 3 distinct branches → flag.
    expect(r2).toHaveLength(1);
    expect(r2[0].metrics.branchCount).toBe(3);
  });

  it("with undefined allowedEdgeKinds, all edge kinds are inspected", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "center"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "center", "import"), edge("b", "center", "call"), edge("c", "center", "call")],
    }));
    const r = runConvergentEngine(store, baseConfig);
    expect(r).toHaveLength(1);
    expect(r[0].metrics.branchCount).toBe(3);
  });
});

/* ── chains and indirect branches ────────────────────────────── */

describe("runConvergentEngine — chains and indirect branches", () => {
  it("counts indirect upstream branches (transitive)", () => {
    // a -> b -> c. a is a transitive upstream of c. With 3 distinct
    // branches a, b, d all reaching e transitively, e is convergent.
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "d", "e"].map((id) => node(id, `src/${id}.ts`)),
      edges: [
        edge("a", "b"), edge("b", "c"), edge("c", "e"),
        edge("d", "e"),
      ],
    }));
    // Add one more direct edge so e has 3 distinct upstream.
    // Actually let me restructure: 3 distinct paths to a center.
    const nodes2 = ["a", "b", "d", "x", "center"].map((id) => node(id, `src/${id}.ts`));
    const edges2 = [
      edge("a", "b"), edge("b", "center"),
      edge("d", "x"), edge("x", "center"),
      edge("a", "center"), // direct path
    ];
    const store2 = new GraphStore(mkSnapshot({ nodes: nodes2, edges: edges2 }));
    const r = runConvergentEngine(store2, baseConfig);
    // Upstream of center: a (direct), b (via a), d, x. So 4 distinct sources.
    expect(r).toHaveLength(1);
    expect(r[0].metrics.branchCount).toBe(4);
  });
});

/* ── signal contract ──────────────────────────────────────────── */

describe("runConvergentEngine — signal contract", () => {
  it("every signal carries anchors, metrics, and limitations", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "d"), edge("b", "d"), edge("c", "d")],
    }));
    const r = runConvergentEngine(store, baseConfig);
    for (const s of r) {
      expect(s.anchors.length).toBeGreaterThan(0);
      expect(Object.keys(s.metrics).length).toBeGreaterThan(0);
      expect(s.limitations.length).toBeGreaterThan(0);
    }
  });

  it("signal id is stable across runs (deterministic)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d"].map((id) => node(id, `src/${id}.ts`)),
      edges: [edge("a", "d"), edge("b", "d"), edge("c", "d")],
    }));
    const r1 = runConvergentEngine(store, baseConfig);
    const r2 = runConvergentEngine(store, baseConfig);
    expect(r1[0].id).toBe(r2[0].id);
  });

  it("severity is high when branchCount >= 2*minBranches", () => {
    // min_branches=2, 5 upstream → 5 >= 2*2 → high
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d", "e", "center"].map((id) => node(id, `src/${id}.ts`)),
      edges: [
        edge("a", "center"), edge("b", "center"), edge("c", "center"),
        edge("d", "center"), edge("e", "center"),
      ],
    }));
    const r = runConvergentEngine(store, { enabled: true, convergent_min_branches: 2 });
    expect(r).toHaveLength(1);
    expect(r[0].severityHint).toBe("high");
  });

  it("severity is medium when branchCount < 2*minBranches", () => {
    // min_branches=3, 4 upstream → 4 < 2*3 → medium
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d", "center"].map((id) => node(id, `src/${id}.ts`)),
      edges: [
        edge("a", "center"), edge("b", "center"),
        edge("c", "center"), edge("d", "center"),
      ],
    }));
    const r = runConvergentEngine(store, { enabled: true, convergent_min_branches: 3 });
    expect(r).toHaveLength(1);
    expect(r[0].severityHint).toBe("medium");
  });
});
