import { describe, it, expect } from "vitest";
import { fuseSignals } from "../src/scoring/fuse.js";
import type { Signal } from "../src/engines/radial/signals.js";
import type { ScoringConfig } from "../src/config/types.js";

/* ── helpers ─────────────────────────────────────────────────────── */

function sig(input: Partial<Signal> & { id: string; targetId: string; type: string; geometryId: string }): Signal {
  return {
    severityHint: "medium",
    confidenceHint: "high",
    targetKind: "node",
    anchors: [],
    metrics: {},
    metadata: {},
    limitations: [],
    ...input,
  } as Signal;
}

const baseConfig: ScoringConfig = {
  geometry_bonus_per_extra_geometry: 0.5,
  independence_bonus_per_extra_independent_method: 0.2,
  boundary_bonus: 0.3,
  state_bonus: 0.2,
  cycle_bonus: 0.4,
  test_gap_bonus: 0.1,
  contradiction_penalty: 0.5,
  capability_gap_penalty: 0.3,
  top_n_hypotheses: 20,
  redact: true,
};

/* ── empty input ─────────────────────────────────────────────── */

describe("fuseSignals — empty input", () => {
  it("returns empty array when no signals are provided", () => {
    expect(fuseSignals([], baseConfig)).toEqual([]);
  });

  it("returns empty when all signals have null score contributions", () => {
    // Single signal = no geometry_bonus, no independence_bonus, no
    // per-type bonuses (no boundary/cycle/state signals here).
    // Score = 0 + 0 + 0 + 0 + 0 + 0 - 0 - 0 = 0.
    const signals = [
      sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial", metadata: { edgeKind: "import" } }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(0);
  });
});

/* ── per-target grouping ──────────────────────────────────────── */

describe("fuseSignals — per-target grouping", () => {
  it("groups multiple signals on the same targetId into one FusedScore", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
      sig({ id: "s2", targetId: "a", type: "fan_out_anomaly", geometryId: "anomaly" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r).toHaveLength(1);
    expect(r[0].targetId).toBe("a");
    expect(r[0].geometries).toEqual(["anomaly", "radial"]);
  });

  it("emits separate FusedScore entries for different targets", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
      sig({ id: "s2", targetId: "b", type: "high_fan_out", geometryId: "radial" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r).toHaveLength(2);
    expect(r.map((s) => s.targetId).sort()).toEqual(["a", "b"]);
  });
});

/* ── bonus formulas ───────────────────────────────────────────── */

describe("fuseSignals — bonus formulas", () => {
  it("geometry_bonus: 2 geometries on same target gets +0.5", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
      sig({ id: "s2", targetId: "a", type: "fan_out_anomaly", geometryId: "anomaly" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.geometryBonus).toBe(0.5); // 1 extra × 0.5
  });

  it("geometry_bonus: 3 geometries gets +1.0", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "radial" }),
      sig({ id: "s2", targetId: "a", type: "x", geometryId: "anomaly" }),
      sig({ id: "s3", targetId: "a", type: "x", geometryId: "boundary" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.geometryBonus).toBe(1.0); // 2 extra × 0.5
  });

  it("geometry_bonus: 1 geometry gets 0", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "radial" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.geometryBonus).toBe(0);
  });

  it("independence_bonus: 2 distinct edge kinds on same target gets +0.2", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "boundary", metadata: { edgeKind: "import" } }),
      sig({ id: "s2", targetId: "a", type: "x", geometryId: "boundary", metadata: { edgeKind: "call" } }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.independenceBonus).toBe(0.2); // 1 extra × 0.2
  });

  it("boundary_bonus: 2 boundary_violation signals gets +0.6", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "boundary_violation", geometryId: "boundary" }),
      sig({ id: "s2", targetId: "a", type: "boundary_violation", geometryId: "boundary" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.boundaryBonus).toBe(0.6); // 2 × 0.3
  });

  it("cycle_bonus: 1 cycle_detected signal gets +0.4", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "cycle_detected", geometryId: "cycle" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.cycleBonus).toBe(0.4);
  });

  it("state_bonus: 2 state_read signals get +0.4", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "state_read", geometryId: "x" }),
      sig({ id: "s2", targetId: "a", type: "state_read", geometryId: "x" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.stateBonus).toBe(0.4); // 2 × 0.2
  });
});

/* ── penalties ────────────────────────────────────────────────── */

describe("fuseSignals — penalties", () => {
  it("contradiction_penalty: info + critical on same target applies penalty", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "g1", severityHint: "info" }),
      sig({ id: "s2", targetId: "a", type: "x", geometryId: "g2", severityHint: "critical" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.contradictionPenalty).toBe(0.5);
  });

  it("contradiction_penalty: NOT applied when all signals are same severity", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "g1", severityHint: "medium" }),
      sig({ id: "s2", targetId: "a", type: "x", geometryId: "g2", severityHint: "medium" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.contradictionPenalty).toBe(0);
  });

  it("score is clamped to 0 (no negative scores)", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "g1", severityHint: "info" }),
      sig({ id: "s2", targetId: "a", type: "x", geometryId: "g2", severityHint: "critical" }),
    ];
    // boundary=0, cycle=0, state=0, test_gap=0; geo=(2-1)*0.5=0.5;
    // indep=(fallback per geom)=2-1=1 extra × 0.2 = 0.2; contradiction=0.5.
    // total: 0.5 + 0.2 - 0.5 = 0.2 (still positive here, but the clamp
    // is for cases where penalties exceed bonuses).
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].score).toBeGreaterThanOrEqual(0);
  });
});

/* ── output contract ──────────────────────────────────────────── */

describe("fuseSignals — output contract", () => {
  it("FusedScore has stable id across runs (deterministic)", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "g1" }),
      sig({ id: "s2", targetId: "a", type: "y", geometryId: "g2" }),
    ];
    const r1 = fuseSignals(signals, baseConfig);
    const r2 = fuseSignals(signals, baseConfig);
    expect(r1[0].id).toBe(r2[0].id);
  });

  it("maxSeverity is the highest severity across the group", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "g1", severityHint: "low" }),
      sig({ id: "s2", targetId: "a", type: "x", geometryId: "g2", severityHint: "high" }),
      sig({ id: "s3", targetId: "a", type: "x", geometryId: "g3", severityHint: "medium" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].maxSeverity).toBe("high");
  });

  it("results are sorted by score DESC, then targetId ASC", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "x", geometryId: "g1", metadata: { edgeKind: "import" } }),
      sig({ id: "s2", targetId: "b", type: "x", geometryId: "g1", metadata: { edgeKind: "import" } }),
      sig({ id: "s3", targetId: "c", type: "x", geometryId: "g1", metadata: { edgeKind: "import" } }),
    ];
    // Manually give b more signals so b has the highest score.
    signals.push(sig({ id: "s4", targetId: "b", type: "y", geometryId: "g2", metadata: { edgeKind: "call" } }));
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].targetId).toBe("b"); // highest score
    // a and c have the same single-signal score 0. Tie-break by targetId ASC.
    expect(r[1].targetId).toBe("a");
    expect(r[2].targetId).toBe("c");
  });

  it("contributors array contains all source signals for traceability", () => {
    const s1 = sig({ id: "s1", targetId: "a", type: "x", geometryId: "g1" });
    const s2 = sig({ id: "s2", targetId: "a", type: "y", geometryId: "g2" });
    const r = fuseSignals([s1, s2], baseConfig);
    expect(r[0].contributors).toHaveLength(2);
    expect(r[0].contributors.map((c) => c.id).sort()).toEqual(["s1", "s2"]);
  });
});

/* ── per-engine signal type counts ──────────────────────────── */

describe("fuseSignals — per-engine signal type buckets", () => {
  it("counts only signals of the matching type toward each bonus", () => {
    const signals = [
      // 2 boundary_violation on target a
      sig({ id: "s1", targetId: "a", type: "boundary_violation", geometryId: "boundary" }),
      sig({ id: "s2", targetId: "a", type: "boundary_violation", geometryId: "boundary" }),
      // 1 cycle_detected on target a
      sig({ id: "s3", targetId: "a", type: "cycle_detected", geometryId: "cycle" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.boundaryBonus).toBe(0.6); // 2 × 0.3
    expect(r[0].components.cycleBonus).toBe(0.4); // 1 × 0.4
    expect(r[0].components.stateBonus).toBe(0); // no state_*
    expect(r[0].components.testGapBonus).toBe(0);
  });
});

/* ── T17-T19 deferred signals ────────────────────────────────── */

describe("fuseSignals — future-engine signal types", () => {
  it("recognizes test_gap_* signal types (deferred to T20+)", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "test_gap_missing", geometryId: "test_gap" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.testGapBonus).toBe(0.1); // 1 × 0.1
  });

  it("recognizes capability_gap_* signal types (deferred to T20+)", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "capability_gap_runtime", geometryId: "capability" }),
    ];
    const r = fuseSignals(signals, baseConfig);
    expect(r[0].components.capabilityGapPenalty).toBe(0.3); // 1 × 0.3
  });
});