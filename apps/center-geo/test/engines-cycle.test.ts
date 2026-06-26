import { describe, it, expect } from "vitest";
import { GraphStore, makeEdgeId, makeNodeId } from "../src/graph/index.js";
import { runCycleEngine } from "../src/engines/cycle/index.js";
import type { GraphEdge, GraphNode, GraphSnapshot } from "../src/graph/types.js";
import type { Signal } from "../src/engines/radial/signals.js";

/* ── helpers ─────────────────────────────────────────────────────── */

function node(
  id: string,
  kind: GraphNode["kind"] = "file",
): GraphNode {
  return { id, kind, label: id, tags: [], metrics: {}, metadata: {} };
}

function edge(
  from: string,
  to: string,
  kind: GraphEdge["kind"] = "import",
): GraphEdge {
  return {
    id: makeEdgeId({ from, to, kind, anchors: [] }),
    from,
    to,
    kind,
    confidence: "high",
    anchors: [
      { path: "src/test.ts", range: { start_line: 1, end_line: 1 }, symbol: from, source: "source" },
    ],
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
    graph_id: "t",
    root: "/",
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

/* ── config gate ───────────────────────────────────────────────── */

describe("runCycleEngine — config gate", () => {
  it("returns empty when enabled=false", () => {
    const a = node("a");
    const store = new GraphStore(mkSnapshot({ nodes: [a], edges: [edge("a", "a")] }));
    expect(runCycleEngine(store, { enabled: false })).toEqual([]);
  });
});

/* ── self-loop ──────────────────────────────────────────────────── */

describe("runCycleEngine — self-loop", () => {
  it("emits a cycle_detected signal for a node with a self-loop", () => {
    const a = node("a");
    const store = new GraphStore(mkSnapshot({ nodes: [a], edges: [edge("a", "a")] }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("cycle_detected");
    expect(r[0].geometryId).toBe("cycle");
    expect(r[0].targetId.startsWith("scc:")).toBe(true);
    expect(r[0].targetKind).toBe("subgraph");
    expect(r[0].metrics.cycleSize).toBe(1);
    expect(r[0].metrics.internalEdges).toBe(1);
    expect(r[0].metadata.members).toEqual(["a"]);
  });

  it("self-loop severity is 'low' (size 1)", () => {
    const a = node("a");
    const store = new GraphStore(mkSnapshot({ nodes: [a], edges: [edge("a", "a")] }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r[0].severityHint).toBe("low");
    expect(r[0].confidenceHint).toBe("high");
  });
});

/* ── multi-node cycles ─────────────────────────────────────────── */

describe("runCycleEngine — multi-node cycles", () => {
  it("emits a cycle_detected for a 2-node cycle", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b"), edge("b", "a")],
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r).toHaveLength(1);
    expect(r[0].metrics.cycleSize).toBe(2);
    expect(r[0].metadata.members.sort()).toEqual(["a", "b"]);
    expect(r[0].severityHint).toBe("low"); // size 2 = low
  });

  it("emits a cycle_detected for a 3-node cycle", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r).toHaveLength(1);
    expect(r[0].metrics.cycleSize).toBe(3);
    expect(r[0].metadata.members.sort()).toEqual(["a", "b", "c"]);
    expect(r[0].severityHint).toBe("medium");
  });

  it("emits a cycle_detected for a 5-node cycle with severity 'high'", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d", "e"].map(node),
      edges: [
        edge("a", "b"),
        edge("b", "c"),
        edge("c", "d"),
        edge("d", "e"),
        edge("e", "a"),
      ],
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r[0].metrics.cycleSize).toBe(5);
    expect(r[0].severityHint).toBe("high");
  });

  it("emits a cycle_detected for a 10-node cycle with severity 'critical'", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: Array.from({ length: 10 }, (_, i) => node("n" + i)),
      edges: Array.from({ length: 10 }, (_, i) =>
        edge("n" + i, "n" + ((i + 1) % 10)),
      ),
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r[0].metrics.cycleSize).toBe(10);
    expect(r[0].severityHint).toBe("critical");
  });
});

/* ── non-cycle graph ──────────────────────────────────────────── */

describe("runCycleEngine — no cycles", () => {
  it("returns empty for a tree (no cycles)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("root"), node("a"), node("b"), node("c")],
      edges: [edge("root", "a"), edge("root", "b"), edge("a", "c")],
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r).toEqual([]);
  });

  it("returns empty for a DAG (no cycles)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d"].map(node),
      edges: [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
    }));
    expect(runCycleEngine(store, { enabled: true })).toEqual([]);
  });

  it("returns empty for a graph with no edges (all singletons)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c"].map(node),
      edges: [],
    }));
    expect(runCycleEngine(store, { enabled: true })).toEqual([]);
  });
});

/* ── multiple cycles in one graph ──────────────────────────────── */

describe("runCycleEngine — multiple cycles", () => {
  it("emits one signal per cyclic SCC", () => {
    // Two disjoint 2-cycles plus a chain.
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d", "e"].map(node),
      edges: [
        edge("a", "b"),
        edge("b", "a"), // cycle 1
        edge("c", "d"),
        edge("d", "c"), // cycle 2
        edge("a", "e"), // chain
      ],
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r).toHaveLength(2);
    // Sort by cycleSize then targetId for determinism in the test.
    const sorted = [...r].sort((a, b) => (a.targetId < b.targetId ? -1 : 1));
    expect(sorted[0].metadata.members.sort()).toEqual(["a", "b"]);
    expect(sorted[1].metadata.members.sort()).toEqual(["c", "d"]);
  });
});

/* ── max_cycle_size filter ─────────────────────────────────────── */

describe("runCycleEngine — max_cycle_size filter", () => {
  it("skips cycles larger than max_cycle_size", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d", "e"].map(node),
      edges: [
        edge("a", "b"),
        edge("b", "c"),
        edge("c", "d"),
        edge("d", "e"),
        edge("e", "a"),
      ],
    }));
    // 5-node cycle, max_cycle_size=3 -> skip
    const r = runCycleEngine(store, { enabled: true, max_cycle_size: 3 });
    expect(r).toEqual([]);
  });

  it("emits cycles at exactly max_cycle_size", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c"].map(node),
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    }));
    // 3-node cycle, max_cycle_size=3 -> include (>=, not >)
    const r = runCycleEngine(store, { enabled: true, max_cycle_size: 3 });
    expect(r).toHaveLength(1);
  });

  it("emits all cycles when max_cycle_size is undefined", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c", "d", "e"].map(node),
      edges: [
        edge("a", "b"),
        edge("b", "c"),
        edge("c", "d"),
        edge("d", "e"),
        edge("e", "a"),
      ],
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r).toHaveLength(1);
  });
});

/* ── signal contract ───────────────────────────────────────────── */

describe("runCycleEngine — signal contract", () => {
  it("every signal carries anchors, metrics, and limitations", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b", "c"].map(node),
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    }));
    const r = runCycleEngine(store, { enabled: true });
    for (const s of r) {
      expect(s.anchors.length).toBeGreaterThan(0);
      expect(Object.keys(s.metrics).length).toBeGreaterThan(0);
      expect(s.limitations.length).toBeGreaterThan(0);
      // Never claim "defect" — severity is a hint, not a claim.
      expect(s.severityHint).not.toBe("defect");
    }
  });

  it("signal id is stable (deterministic across runs)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b"].map(node),
      edges: [edge("a", "b"), edge("b", "a")],
    }));
    const r1 = runCycleEngine(store, { enabled: true });
    const r2 = runCycleEngine(store, { enabled: true });
    expect(r1[0].id).toBe(r2[0].id);
  });
});

/* ── non-import edge kinds also count as cycles ───────────────── */

describe("runCycleEngine — non-import edge kinds", () => {
  it("emits a cycle for a call-cycle (not just imports)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: ["a", "b"].map(node),
      edges: [edge("a", "b", "call"), edge("b", "a", "call")],
    }));
    const r = runCycleEngine(store, { enabled: true });
    expect(r).toHaveLength(1);
    expect(r[0].metrics.cycleSize).toBe(2);
  });
});
