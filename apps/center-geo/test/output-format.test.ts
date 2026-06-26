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
    // Use regex word-boundary to avoid matching 'c' in 'score' or 'critical'.
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
  it("emits valid JSON with schema_version + count + hypotheses", () => {
    const out = formatJson([
      fused({ targetId: "a", score: 1.5, maxSeverity: "high", geometries: ["anomaly"] }),
    ], 5, 3);
    const parsed: JsonReport = JSON.parse(out);
    expect(parsed.schema_version).toBe("1.0.0");
    expect(parsed.count).toBe(1);
    expect(parsed.raw_signal_count).toBe(3);
    expect(parsed.hypotheses).toHaveLength(1);
    expect(parsed.hypotheses[0].targetId).toBe("a");
    expect(parsed.hypotheses[0].score).toBe(1.5);
    expect(parsed.hypotheses[0].maxSeverity).toBe("high");
  });

  it("caps output at topN", () => {
    const out = formatJson([
      fused({ targetId: "a" }),
      fused({ targetId: "b" }),
      fused({ targetId: "c" }),
    ], 2, 3);
    const parsed: JsonReport = JSON.parse(out);
    expect(parsed.count).toBe(2);
    expect(parsed.hypotheses).toHaveLength(2);
    expect(parsed.raw_signal_count).toBe(3);
  });

  it("returns valid JSON even with empty fused list", () => {
    const out = formatJson([], 5, 0);
    const parsed: JsonReport = JSON.parse(out);
    expect(parsed.count).toBe(0);
    expect(parsed.raw_signal_count).toBe(0);
    expect(parsed.hypotheses).toEqual([]);
  });

  it("preserves all FusedScore fields (incl. contributors, components)", () => {
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
    ], 5, 1);
    const parsed: JsonReport = JSON.parse(out);
    const h = parsed.hypotheses[0];
    expect(h.components.boundaryBonus).toBe(0.3);
    expect(h.components.cycleBonus).toBe(0.4);
    expect(h.edgeKinds).toEqual(["import"]);
  });
});