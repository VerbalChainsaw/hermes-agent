import { describe, it, expect } from "vitest";
import { GraphStore, makeEdgeId } from "../src/graph/index.js";
import type { GraphNode, GraphEdge, GraphSnapshot } from "../src/graph/types.js";
import { runPathEngine } from "../src/engines/path/index.js";

function node(id: string, path: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind: "file",
    label: id,
    path,
    tags: [],
    metrics: {},
    metadata: {},
    ...overrides,
  };
}

function edge(from: string, to: string, kind: GraphEdge["kind"] = "call"): GraphEdge {
  return {
    id: makeEdgeId({ from, to, kind, anchors: [] }),
    from,
    to,
    kind,
    confidence: kind === "unknown_dynamic" ? "low" : "high",
    anchors: [],
    tags: [],
    metadata: {},
  };
}

function mkSnapshot(opts: { nodes: GraphNode[]; edges: GraphEdge[] }): GraphSnapshot {
  return {
    schema_version: "1.0.0",
    tool_version: "0.1.0",
    graph_id: "test",
    root: "/test",
    coverage: {
      files_seen: 0,
      files_parsed: 0,
      files_failed: 0,
      edges_low_confidence: 0,
      parse_ms: 0,
      graph_build_ms: 0,
    },
    nodes: opts.nodes,
    edges: opts.edges,
    warnings: [],
  };
}

describe("runPathEngine", () => {
  it("emits long_path for an entry-to-sink route over the configured threshold", () => {
    const entry = node("entry", "src/ui/page.ts");
    const mid = node("mid", "src/lib/service.ts");
    const sink = node("sink", "src/db/store.ts");
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry, mid, sink],
        edges: [edge("entry", "mid"), edge("mid", "sink")],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        long_path_min_length: 2,
        path_count_cap: 10,
        max_depth: 10,
      },
      {
        tagGlobs: {
          entry: ["src/ui/**"],
          sink: ["src/db/**"],
        },
      },
    );

    const longPath = signals.find((signal) => signal.type === "long_path");
    expect(longPath).toBeTruthy();
    expect(longPath?.targetKind).toBe("path");
    expect(longPath?.metrics.pathLength).toBe(2);
    expect(longPath?.metadata.pathNodeIds).toEqual(["entry", "mid", "sink"]);
  });

  it("emits long_path for symbol-selector entry/sink tags", () => {
    const entry = node("entry-fn", "src/api/flow.ts", {
      kind: "function",
      symbol: "src/api/flow.ts::entry",
    });
    const mid = node("mid-fn", "src/api/flow.ts", {
      kind: "function",
      symbol: "src/api/flow.ts::mid",
    });
    const sink = node("sink-fn", "src/api/flow.ts", {
      kind: "function",
      symbol: "src/api/flow.ts::sink",
    });
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry, mid, sink],
        edges: [edge("entry-fn", "mid-fn"), edge("mid-fn", "sink-fn")],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        long_path_min_length: 2,
        path_count_cap: 10,
        max_depth: 10,
      },
      {
        tagSelectors: {
          entry: { symbols: ["src/api/flow.ts::entry"] },
          sink: { symbols: ["src/api/flow.ts::sink"] },
        },
      },
    );

    const longPath = signals.find((signal) => signal.type === "long_path");
    expect(longPath).toBeTruthy();
    expect(longPath?.metadata.pathNodeIds).toEqual(["entry-fn", "mid-fn", "sink-fn"]);
  });

  it("emits unknown_dynamic_handoff and stops there instead of pretending the sink was reached", () => {
    const entry = node("entry", "src/ui/page.ts");
    const mid = node("mid", "src/lib/service.ts");
    const dynamic = node("dynamic", "src/lib/dynamic.ts");
    const sink = node("sink", "src/db/store.ts");
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry, mid, dynamic, sink],
        edges: [
          edge("entry", "mid"),
          edge("mid", "dynamic", "unknown_dynamic"),
          edge("dynamic", "sink"),
        ],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        long_path_min_length: 1,
        path_count_cap: 10,
        max_depth: 10,
      },
      {
        tagGlobs: {
          entry: ["src/ui/**"],
          sink: ["src/db/**"],
        },
      },
    );

    expect(signals.some((signal) => signal.type === "unknown_dynamic_handoff")).toBe(true);
    expect(signals.some((signal) => signal.type === "long_path")).toBe(false);
  });

  it("degrades explicitly when an allowed edge points at a node the graph never emitted", () => {
    const entry = node("entry", "src/ui/page.ts");
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry],
        edges: [edge("entry", "missing-target", "import")],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        long_path_min_length: 1,
        path_count_cap: 10,
        max_depth: 10,
        allowed_edge_kinds: ["import"],
      },
      {
        tagGlobs: {
          entry: ["src/ui/**"],
          sink: ["src/db/**"],
        },
      },
    );

    const degraded = signals.find((signal) => signal.type === "unknown_dynamic_handoff");
    expect(degraded).toBeTruthy();
    expect(degraded?.metadata.missingTarget).toBe(true);
  });

  it("handles repeated nodes without looping and still finds the sink path once", () => {
    const entry = node("entry", "src/ui/page.ts");
    const a = node("a", "src/lib/a.ts");
    const b = node("b", "src/lib/b.ts");
    const sink = node("sink", "src/db/store.ts");
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry, a, b, sink],
        edges: [
          edge("entry", "a"),
          edge("a", "b"),
          edge("b", "a"),
          edge("b", "sink"),
        ],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        long_path_min_length: 3,
        path_count_cap: 10,
        max_depth: 10,
      },
      {
        tagGlobs: {
          entry: ["src/ui/**"],
          sink: ["src/db/**"],
        },
      },
    );

    const longPath = signals.find((signal) => signal.type === "long_path");
    expect(longPath).toBeTruthy();
    expect(longPath?.metadata.pathNodeIds).toEqual(["entry", "a", "b", "sink"]);
    expect(new Set((longPath?.metadata.pathNodeIds as string[]) ?? []).size).toBe(4);
  });

  it("emits entry_to_sink_without_guard_candidate when a guarded path reaches the sink without a guard", () => {
    const entry = node("entry", "src/ui/page.ts");
    const mid = node("mid", "src/lib/service.ts");
    const sink = node("sink", "src/db/store.ts");
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry, mid, sink],
        edges: [edge("entry", "mid"), edge("mid", "sink")],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        guard_tags: ["guard"],
        long_path_min_length: 99,
        path_count_cap: 10,
        max_depth: 10,
      },
      {
        tagGlobs: {
          entry: ["src/ui/**"],
          sink: ["src/db/**"],
          guard: ["src/api/**"],
        },
      },
    );

    const guardless = signals.find(
      (signal) => signal.type === "entry_to_sink_without_guard_candidate",
    );
    expect(guardless).toBeTruthy();
    expect(guardless?.metadata.guardTags).toEqual(["guard"]);
  });

  it("emits test_gap_on_public_path when the graph knows about tests but not for this path", () => {
    const entry = node("entry", "src/ui/page.ts");
    const mid = node("mid", "src/lib/service.ts");
    const sink = node("sink", "src/db/store.ts");
    const tested = node("tested", "src/lib/tested.ts");
    const testNode = {
      id: "test-node",
      kind: "test",
      label: "test-node",
      path: "test/service.test.ts",
      tags: ["test"],
      metrics: {},
      metadata: {},
    } satisfies GraphNode;
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry, mid, sink, tested, testNode],
        edges: [
          edge("entry", "mid"),
          edge("mid", "sink"),
          edge("test-node", "tested", "test_of"),
        ],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        long_path_min_length: 99,
        path_count_cap: 10,
        max_depth: 10,
      },
      {
        tagGlobs: {
          entry: ["src/ui/**"],
          sink: ["src/db/**"],
        },
      },
    );

    expect(signals.some((signal) => signal.type === "test_gap_on_public_path")).toBe(true);
  });

  it("respects path_count_cap", () => {
    const entry = node("entry", "src/ui/page.ts");
    const midA = node("midA", "src/lib/a.ts");
    const midB = node("midB", "src/lib/b.ts");
    const sinkA = node("sinkA", "src/db/a.ts");
    const sinkB = node("sinkB", "src/db/b.ts");
    const store = new GraphStore(
      mkSnapshot({
        nodes: [entry, midA, midB, sinkA, sinkB],
        edges: [
          edge("entry", "midA"),
          edge("midA", "sinkA"),
          edge("entry", "midB"),
          edge("midB", "sinkB"),
        ],
      }),
    );

    const signals = runPathEngine(
      store,
      {
        enabled: true,
        entry_tags: ["entry"],
        sink_tags: ["sink"],
        long_path_min_length: 2,
        path_count_cap: 1,
        max_depth: 10,
      },
      {
        tagGlobs: {
          entry: ["src/ui/**"],
          sink: ["src/db/**"],
        },
      },
    );

    expect(signals.filter((signal) => signal.type === "long_path")).toHaveLength(1);
  });
});
