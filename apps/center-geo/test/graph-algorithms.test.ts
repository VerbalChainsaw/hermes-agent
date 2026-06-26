import { describe, it, expect } from "vitest";
import { GraphStore, bfs, reverseBfs, stronglyConnectedComponents, makeNodeId, makeEdgeId } from "../src/graph/index.js";
import type { GraphEdge, GraphNode, GraphSnapshot } from "../src/graph/types.js";

/* ── helpers ─────────────────────────────────────────────────────── */

function node(id: string, kind: GraphNode["kind"] = "file", tags: string[] = []): GraphNode {
  return {
    id, kind, label: id, tags, metrics: {}, metadata: {},
  };
}

function edge(from: string, to: string, kind: GraphEdge["kind"] = "import"): GraphEdge {
  return {
    id: makeEdgeId({ from, to, kind, anchors: [] }),
    from, to, kind, confidence: "high", anchors: [], tags: [], metadata: {},
  };
}

function mkSnapshot(opts: { nodes?: GraphNode[]; edges?: GraphEdge[] }): GraphSnapshot {
  return {
    schema_version: "1.0.0",
    tool_version: "0.1.0",
    graph_id: "test",
    root: "/test",
    coverage: {
      files_seen: 0, files_parsed: 0, files_failed: 0,
      edges_low_confidence: 0, parse_ms: 0, graph_build_ms: 0,
    },
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
    warnings: [],
  };
}

/* ── BFS ─────────────────────────────────────────────────────────── */

describe("bfs", () => {
  it("returns depth 0 for the seed itself", () => {
    const store = new GraphStore(mkSnapshot({ nodes: [node("a")] }));
    const r = bfs(store, "a");
    expect(r.depth.get("a")).toBe(0);
    expect(r.reachableInOrder).toEqual(["a"]);
  });

  it("returns shortest path depth for a chain", () => {
    // a -> b -> c -> d
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "d")],
    }));
    const r = bfs(store, "a");
    expect(r.depth.get("a")).toBe(0);
    expect(r.depth.get("b")).toBe(1);
    expect(r.depth.get("c")).toBe(2);
    expect(r.depth.get("d")).toBe(3);
  });

  it("returns empty for a non-existent seed", () => {
    const store = new GraphStore(mkSnapshot({ nodes: [node("a")] }));
    const r = bfs(store, "nonexistent");
    expect(r.depth.size).toBe(0);
  });

  it("respects multi-edges (records the first edge to reach each node)", () => {
    // a -> b via two edges
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b", "import"), edge("a", "b", "call")],
    }));
    const r = bfs(store, "a");
    expect(r.depth.get("b")).toBe(1);
    // b is reached via the first edge (import — comes first by sort).
    expect(r.parents.get("b")).not.toBeNull();
  });

  it("BFS order is deterministic across runs", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("a", "c")],
    }));
    const r1 = bfs(store, "a");
    const r2 = bfs(store, "a");
    expect(r1.reachableInOrder).toEqual(r2.reachableInOrder);
    // Sorted adjacency: b before c (by id).
    expect(r1.reachableInOrder).toEqual(["a", "b", "c"]);
  });
});

/* ── reverse BFS ───────────────────────────────────────────────── */

describe("reverseBfs", () => {
  it("walks upstream (incoming) instead of downstream (outgoing)", () => {
    // a -> b -> c -> d (caller chain)
    // reverseBfs(d) reaches a, b, c via INCOMING edges.
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "d")],
    }));
    const r = reverseBfs(store, "d");
    // Upstream: d -> c -> b -> a
    expect(r.depth.get("d")).toBe(0);
    expect(r.depth.get("c")).toBe(1);
    expect(r.depth.get("b")).toBe(2);
    expect(r.depth.get("a")).toBe(3);
  });

  it("returns empty for a non-existent seed", () => {
    const store = new GraphStore(mkSnapshot({ nodes: [node("a")] }));
    const r = reverseBfs(store, "nope");
    expect(r.depth.size).toBe(0);
  });
});

/* ── SCC ────────────────────────────────────────────────────────── */

describe("stronglyConnectedComponents", () => {
  it("returns no components for a graph with no edges", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b"), node("c")],
      edges: [],
    }));
    const sccs = stronglyConnectedComponents(store);
    // Each node is its own singleton SCC. Three of them.
    expect(sccs.length).toBe(3);
    for (const s of sccs) {
      expect(s.members.length).toBe(1);
      expect(s.isCycle).toBe(false);
    }
  });

  it("detects a 2-node cycle (a -> b -> a)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b", "call"), edge("b", "a", "call")],
    }));
    const sccs = stronglyConnectedComponents(store);
    expect(sccs.length).toBe(1);
    expect(sccs[0].members.sort()).toEqual(["a", "b"]);
    expect(sccs[0].isCycle).toBe(true);
  });

  it("detects a 3-node cycle (a -> b -> c -> a)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    }));
    const sccs = stronglyConnectedComponents(store);
    expect(sccs.length).toBe(1);
    expect(sccs[0].members.sort()).toEqual(["a", "b", "c"]);
    expect(sccs[0].isCycle).toBe(true);
  });

  it("detects a self-loop as a cycle (1 node, 1 edge to itself)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a")],
      edges: [edge("a", "a", "call")],
    }));
    const sccs = stronglyConnectedComponents(store);
    expect(sccs.length).toBe(1);
    expect(sccs[0].members).toEqual(["a"]);
    expect(sccs[0].isCycle).toBe(true);
  });

  it("does NOT flag a tree as a cycle", () => {
    // root -> a, root -> b, a -> leaf
    const store = new GraphStore(mkSnapshot({
      nodes: [node("root"), node("a"), node("b"), node("leaf")],
      edges: [edge("root", "a"), edge("root", "b"), edge("a", "leaf")],
    }));
    const sccs = stronglyConnectedComponents(store);
    // 4 singleton SCCs, none cycles.
    expect(sccs.length).toBe(4);
    for (const s of sccs) {
      expect(s.isCycle).toBe(false);
    }
  });

  it("returns SCCs sorted by size desc, then by first-member id", () => {
    // Two SCCs: {a,b,c} (size 3) and {d,e} (size 2).
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b"), node("c"), node("d"), node("e")],
      edges: [
        edge("a", "b"), edge("b", "c"), edge("c", "a"),
        edge("d", "e"), edge("e", "d"),
      ],
    }));
    const sccs = stronglyConnectedComponents(store);
    expect(sccs.length).toBe(2);
    // Largest first.
    expect(sccs[0].members.length).toBe(3);
    expect(sccs[0].members.sort()).toEqual(["a", "b", "c"]);
    expect(sccs[1].members.length).toBe(2);
    expect(sccs[1].members.sort()).toEqual(["d", "e"]);
  });

  it("includes internal edges (edges entirely within the component)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b"), edge("b", "a")],
    }));
    const sccs = stronglyConnectedComponents(store);
    expect(sccs.length).toBe(1);
    expect(sccs[0].edges.length).toBe(2);
  });

  it("deterministic across runs (same input -> same output)", () => {
    const opts = {
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("d", "a")],
    };
    const s1 = stronglyConnectedComponents(new GraphStore(mkSnapshot(opts)));
    const s2 = stronglyConnectedComponents(new GraphStore(mkSnapshot(opts)));
    expect(s1.map((s) => s.id)).toEqual(s2.map((s) => s.id));
    expect(s1.map((s) => s.members)).toEqual(s2.map((s) => s.members));
  });
});
