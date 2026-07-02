import { describe, it, expect } from "vitest";
import { formatHuman, formatJson, type JsonReport } from "../src/output/format.js";
import type { FusedScore } from "../src/scoring/types.js";

function fused(input: Partial<FusedScore> & { targetId: string }): FusedScore {
  return {
    id: "f:" + input.targetId,
    targetKind: "node",
    score: 0,
    maxSeverity: "info",
    geometries: [],
    edgeKinds: [],
    contributors: [],
    components: {
      geometryBonus: 0,
      independenceBonus: 0,
      boundaryBonus: 0,
      stateBonus: 0,
      cycleBonus: 0,
      testGapBonus: 0,
      contradictionPenalty: 0,
      capabilityGapPenalty: 0,
    },
    ...input,
  };
}

const coverage = {
  files_seen: 10,
  files_parsed: 10,
  files_failed: 0,
  edges_low_confidence: 0,
  parse_ms: 0,
  graph_build_ms: 0,
  files_indexed: 10,
  files_skipped: 0,
  nodes_total: 20,
  edges_total: 30,
  unsupported_files: 0,
  generated_files: 0,
  parse_failure_paths: [],
};

const reportMeta = {
  toolVersion: "0.1.0",
  scanFrame: {
    root: ".",
    mode: "scan",
    config_hash: "cfg123",
    graph_id: "scan:abc123",
    revision: {
      vcs: "none",
      snapshot_hash: "abc123",
    },
  },
  engineRuns: [{ geometry_id: "radial", status: "completed" }],
  signals: [],
  warnings: [],
};

/* ── human format ──────────────────────────────────────────────── */

describe("formatHuman", () => {
  it("emits one line per hypothesis with score, severity, target, geometries", () => {
    const out = formatHuman([
      fused({ targetId: "a", score: 1.5, maxSeverity: "high", geometries: ["anomaly", "radial"] }),
      fused({ targetId: "b", score: 0.5, maxSeverity: "low", geometries: ["boundary"] }),
    ], 5);
    expect(out).toMatch(/score=1\.50 high\s+node -> a/);
    expect(out).toMatch(/score=0\.50 low\s+node -> b/);
  });

  it("caps output at topN", () => {
    const out = formatHuman([
      fused({ targetId: "a", score: 1 }),
      fused({ targetId: "b", score: 0.5 }),
      fused({ targetId: "c", score: 0.25 }),
    ], 2);
    expect(out).toMatch(/\ba\b/);
    expect(out).toMatch(/\bb\b/);
    expect(out).not.toMatch(/\bc\b/);
    expect(out).toContain("... and 1 more");
  });

  it("returns '(no fused hypotheses)' when empty", () => {
    expect(formatHuman([], 5)).toContain("(no fused hypotheses)");
  });
});

/* ── json format ───────────────────────────────────────────────── */

describe("formatJson", () => {
  it("emits spec-shaped JSON report envelope with required top-level fields", () => {
    const out = formatJson([
      fused({ targetId: "a", score: 1.5, maxSeverity: "high", geometries: ["anomaly"] }),
    ], 5, 3, coverage, reportMeta);
    const parsed = JSON.parse(out) as JsonReport & Record<string, any>;
    expect(parsed.schema_version).toBe("1.0.0");
    expect(parsed.count).toBe(1);
    expect(parsed.raw_signal_count).toBe(3);
    expect(parsed.tool_version).toBe("0.1.0");
    expect(parsed.scan_frame.root).toBe(".");
    expect(parsed.scan_frame.config_hash).toBe("cfg123");
    expect(parsed.engine_runs).toEqual([{ geometry_id: "radial", status: "completed" }]);
    expect(parsed.signals).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.hypotheses).toHaveLength(1);
    expect(parsed.hypotheses[0].targetId).toBe("a");
    expect(parsed.hypotheses[0].title).toBeDefined();
    expect(parsed.hypotheses[0].status).toBe("hypothesis");
    expect(parsed.hypotheses[0].target).toBeDefined();
    expect(parsed.hypotheses[0].contributing_signal_ids).toEqual([]);
    expect(parsed.hypotheses[0].contributing_geometries).toEqual(["anomaly"]);
    expect(parsed.hypotheses[0].score.rank_score).toBe(1.5);
    expect(parsed.hypotheses[0].score.severity).toBe("high");
    expect(Array.isArray(parsed.hypotheses[0].score.calculation_notes)).toBe(true);
    expect(parsed.hypotheses[0].investigation_packet).toBeDefined();
    expect(Array.isArray(parsed.hypotheses[0].limitations)).toBe(true);
  });

  it("caps output at topN", () => {
    const out = formatJson([
      fused({ targetId: "a" }),
      fused({ targetId: "b" }),
      fused({ targetId: "c" }),
    ], 2, 3, coverage, reportMeta);
    const parsed: JsonReport = JSON.parse(out);
    expect(parsed.count).toBe(2);
    expect(parsed.hypotheses).toHaveLength(2);
    expect(parsed.raw_signal_count).toBe(3);
  });

  it("returns valid JSON even with empty fused list", () => {
    const out = formatJson([], 5, 0, coverage, reportMeta);
    const parsed = JSON.parse(out) as JsonReport & Record<string, any>;
    expect(parsed.count).toBe(0);
    expect(parsed.raw_signal_count).toBe(0);
    expect(parsed.tool_version).toBe("0.1.0");
    expect(parsed.hypotheses).toEqual([]);
  });

  it("preserves fused-score compatibility fields while adding hypothesis score object", () => {
    const out = formatJson([
      fused({
        targetId: "a",
        score: 2.0,
        maxSeverity: "critical",
        geometries: ["boundary", "cycle"],
        edgeKinds: ["import"],
        components: {
          geometryBonus: 0.5,
          independenceBonus: 0,
          boundaryBonus: 0.3,
          stateBonus: 0,
          cycleBonus: 0.4,
          testGapBonus: 0,
          contradictionPenalty: 0,
          capabilityGapPenalty: 0,
        },
      }),
    ], 5, 1, coverage, reportMeta);
    const parsed = JSON.parse(out) as JsonReport & Record<string, any>;
    const h = parsed.hypotheses[0];
    expect(h.components.boundaryBonus).toBe(0.3);
    expect(h.components.cycleBonus).toBe(0.4);
    expect(h.edgeKinds).toEqual(["import"]);
    expect(h.score.rank_score).toBe(2.0);
    expect(h.score.severity).toBe("critical");
  });
});
