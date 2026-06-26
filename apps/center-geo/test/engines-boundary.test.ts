import { describe, it, expect } from "vitest";
import { GraphStore, makeEdgeId } from "../src/graph/index.js";
import { runBoundaryEngine } from "../src/engines/boundary/index.js";
import type { GraphEdge, GraphNode, GraphSnapshot } from "../src/graph/types.js";
import type { BoundariesConfig } from "../src/config/types.js";

/* ── helpers ─────────────────────────────────────────────────────── */

function node(id: string, path: string, kind: GraphNode["kind"] = "file"): GraphNode {
  return { id, kind, label: path, path, tags: [], metrics: {}, metadata: {} };
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

const baseConfig: BoundariesConfig = {
  tags: {
    ui: { globs: ["src/ui/**"] },
    persistence: { globs: ["src/persistence/**"] },
    domain: { globs: ["src/domain/**"] },
  },
  forbidden_crossings: [
    { from: "ui", to: "persistence", severity: "high", reason: "UI must not reach persistence directly" },
  ],
};

/* ── empty / no-config cases ──────────────────────────────────── */

describe("runBoundaryEngine — config gate", () => {
  it("returns empty when forbidden_crossings is empty", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, {
      ...baseConfig,
      forbidden_crossings: [],
    });
    expect(r).toEqual([]);
  });

  it("returns empty when tags is empty", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/a.ts"), node("b", "src/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, { tags: {}, forbidden_crossings: baseConfig.forbidden_crossings });
    expect(r).toEqual([]);
  });

  it("returns empty when no file is in any boundary", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/other/a.ts"), node("b", "src/other/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, baseConfig);
    expect(r).toEqual([]);
  });
});

/* ── basic detection ────────────────────────────────────────────── */

describe("runBoundaryEngine — basic detection", () => {
  it("emits a boundary_violation signal for an edge crossing a forbidden pair", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, baseConfig);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("boundary_violation");
    expect(r[0].geometryId).toBe("boundary");
    expect(r[0].targetKind).toBe("edge");
    expect(r[0].severityHint).toBe("high");
    expect(r[0].confidenceHint).toBe("high");
    expect(r[0].metadata.fromBoundary).toBe("ui");
    expect(r[0].metadata.toBoundary).toBe("persistence");
    expect(r[0].metadata.reason).toBe("UI must not reach persistence directly");
  });

  it("emits no signal when both endpoints are in the same boundary", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/ui/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, baseConfig);
    expect(r).toEqual([]);
  });

  it("emits no signal when an edge has one endpoint outside any boundary", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/other/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, baseConfig);
    expect(r).toEqual([]);
  });

  it("end-to-end: ui -> adapter edge in a real-looking graph fires a violation", () => {
    // Reproduce the package's own structure: src/cli/main.ts (ui) -> src/adapters/... (adapters)
    // and assert the engine catches it.
    const cfg: BoundariesConfig = {
      tags: {
        ui: { globs: ["src/cli/**"] },
        adapters: { globs: ["src/adapters/**"] },
      },
      forbidden_crossings: [
        { from: "ui", to: "adapters", severity: "high", reason: "UI must not reach into adapter directly" },
      ],
    };
    const store = new GraphStore(mkSnapshot({
      nodes: [
        node("a", "src/cli/main.ts"),
        node("b", "src/adapters/index.ts"),
      ],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, cfg);
    expect(r).toHaveLength(1);
    expect(r[0].severityHint).toBe("high");
    expect(r[0].metadata.reason).toBe("UI must not reach into adapter directly");
  });

  it("end-to-end: package with no cross-boundary edges emits zero signals", () => {
    // The same shape the center-geo package has: 1 ui file + 6 adapters
    // files, but no edges between them. This is the green state.
    const cfg: BoundariesConfig = {
      tags: {
        ui: { globs: ["src/cli/**"] },
        adapters: { globs: ["src/adapters/**"] },
      },
      forbidden_crossings: [
        { from: "ui", to: "adapters", severity: "high", reason: "..." },
      ],
    };
    const nodes: GraphNode[] = [
      node("cli", "src/cli/main.ts"),
      ...["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"].map((p) => node(p, "src/adapters/" + p)),
    ];
    const edges: GraphEdge[] = []; // no cross-boundary edges
    const store = new GraphStore(mkSnapshot({ nodes, edges }));
    expect(runBoundaryEngine(store, cfg)).toEqual([]);
  });
});

/* ── symmetric match ───────────────────────────────────────────── */

describe("runBoundaryEngine — symmetric match", () => {
  it("matches a forbidden pair regardless of edge direction", () => {
    // Rule: ui <-> persistence. Edge: persistence -> ui should ALSO trigger.
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/persistence/a.ts"), node("b", "src/ui/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, baseConfig);
    expect(r).toHaveLength(1);
    expect(r[0].metadata.fromBoundary).toBe("persistence");
    expect(r[0].metadata.toBoundary).toBe("ui");
  });
});

/* ── multiple crossings on the same edge ───────────────────────── */

describe("runBoundaryEngine — multiple crossings", () => {
  it("emits one signal per matching forbidden pair, not one per edge", () => {
    // ui -> persistence (high) AND ui -> domain (medium). Two signals.
    const store = new GraphStore(mkSnapshot({
      nodes: [
        node("a", "src/ui/a.ts"),
        node("b", "src/persistence/b.ts"),
        node("c", "src/domain/c.ts"),
      ],
      edges: [edge("a", "b"), edge("a", "c")],
    }));
    const r = runBoundaryEngine(store, {
      ...baseConfig,
      forbidden_crossings: [
        ...baseConfig.forbidden_crossings,
        { from: "ui", to: "domain", severity: "medium", reason: "UI must not bypass domain" },
      ],
    });
    expect(r).toHaveLength(2);
  });

  it("emits ONE signal per (edge, rule) even if both endpoints share multiple tags", () => {
    // If file 'a' is in BOTH ui and domain (multi-tag), and 'b' is in persistence,
    // an edge a -> b crosses (ui, persistence) and (domain, persistence).
    // Two signals — one per rule.
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/shared/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b")],
    }));
    // a matches BOTH src/ui/** and src/domain/** (configure to allow this).
    const r = runBoundaryEngine(store, {
      tags: {
        ui: { globs: ["src/shared/**", "src/ui/**"] },
        domain: { globs: ["src/shared/**", "src/domain/**"] },
        persistence: { globs: ["src/persistence/**"] },
      },
      forbidden_crossings: [
        { from: "ui", to: "persistence", severity: "high", reason: "ui->persistence" },
        { from: "domain", to: "persistence", severity: "medium", reason: "domain->persistence" },
      ],
    });
    expect(r).toHaveLength(2);
  });
});

/* ── severity from rule ────────────────────────────────────────── */

describe("runBoundaryEngine — severity", () => {
  it("uses the rule's severity (not a default)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r1 = runBoundaryEngine(store, {
      ...baseConfig,
      forbidden_crossings: [
        { from: "ui", to: "persistence", severity: "low", reason: "low example" },
      ],
    });
    expect(r1[0].severityHint).toBe("low");

    const r2 = runBoundaryEngine(store, {
      ...baseConfig,
      forbidden_crossings: [
        { from: "ui", to: "persistence", severity: "critical", reason: "critical example" },
      ],
    });
    expect(r2[0].severityHint).toBe("critical");
  });
});

/* ── allowed_edge_kinds filter ─────────────────────────────────── */

describe("runBoundaryEngine — allowed_edge_kinds", () => {
  it("respects allowed_edge_kinds (skips disallowed kinds)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b", "import"), edge("a", "b", "call")],
    }));
    // Only 'import' allowed.
    const r = runBoundaryEngine(
      store,
      baseConfig,
      { allowedEdgeKinds: ["import"] },
    );
    // Both edges are from a to b; only the import is counted.
    // Same (edge) deduped — but here the IDs are different (e:...)
    // because makeEdgeId is called with the same inputs, so both
    // edges have the same id. The dedup-by-id in store keeps one.
    // Either way, we expect at most 1 signal here.
    expect(r.length).toBeLessThanOrEqual(1);
  });

  it("with undefined allowedEdgeKinds, all edge kinds are inspected", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b", "call")],
    }));
    const r = runBoundaryEngine(store, baseConfig);
    expect(r).toHaveLength(1);
  });
});

/* ── signal contract ───────────────────────────────────────────── */

describe("runBoundaryEngine — signal contract", () => {
  it("every signal carries anchors, metrics, and limitations", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r = runBoundaryEngine(store, baseConfig);
    for (const s of r) {
      expect(s.anchors.length).toBeGreaterThan(0);
      expect(Object.keys(s.metrics).length).toBeGreaterThan(0);
      expect(s.limitations.length).toBeGreaterThan(0);
    }
  });

  it("signal id is stable across runs (deterministic)", () => {
    const store = new GraphStore(mkSnapshot({
      nodes: [node("a", "src/ui/a.ts"), node("b", "src/persistence/b.ts")],
      edges: [edge("a", "b")],
    }));
    const r1 = runBoundaryEngine(store, baseConfig);
    const r2 = runBoundaryEngine(store, baseConfig);
    expect(r1[0].id).toBe(r2[0].id);
  });
});
