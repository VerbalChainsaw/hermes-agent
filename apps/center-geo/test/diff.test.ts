import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffReports, readReport } from "../src/diff/index.js";
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

async function writeReport(path: string, hyps: FusedScore[]): Promise<void> {
  const report = {
    schema_version: "1.0.0" as const,
    count: hyps.length,
    raw_signal_count: 0,
    hypotheses: hyps,
  };
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
}

/* ── readReport ──────────────────────────────────────────────────── */

describe("readReport", () => {
  it("parses a valid report.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-diff-"));
    try {
      const path = join(dir, "report.json");
      await writeReport(path, [
        fused({ targetId: "a", score: 1.5 }),
        fused({ targetId: "b", score: 0.5 }),
      ]);
      const result = await readReport(path);
      expect(result).toHaveLength(2);
      expect(result[0].targetId).toBe("a");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("rejects a malformed file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-diff-"));
    try {
      const path = join(dir, "bad.json");
      await writeFile(path, "{}", "utf-8");
      await expect(readReport(path)).rejects.toThrow(/missing 'hypotheses'/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

/* ── diffReports ─────────────────────────────────────────────────── */

describe("diffReports", () => {
  it("detects new hypotheses (in head but not in base)", () => {
    const base = [fused({ targetId: "a", score: 1.5 })];
    const head = [
      fused({ targetId: "a", score: 1.5 }),
      fused({ targetId: "b", score: 1.0, maxSeverity: "high" }),
      fused({ targetId: "c", score: 0.5 }),
    ];
    const d = diffReports(base, head, "base", "head");
    expect(d.new_hypotheses).toHaveLength(2);
    expect(d.new_hypotheses.map((h) => h.targetId).sort()).toEqual(["b", "c"]);
  });

  it("detects resolved hypotheses (in base but not in head)", () => {
    const base = [
      fused({ targetId: "a", score: 1.5 }),
      fused({ targetId: "x", score: 1.0 }),
      fused({ targetId: "y", score: 0.5 }),
    ];
    const head = [fused({ targetId: "a", score: 1.5 })];
    const d = diffReports(base, head, "base", "head");
    expect(d.resolved_hypotheses).toHaveLength(2);
    expect(d.resolved_hypotheses.map((h) => h.targetId).sort()).toEqual(["x", "y"]);
  });

  it("detects changed hypotheses (score or severity differ)", () => {
    const base = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "medium" }),
      fused({ targetId: "b", score: 2.0, maxSeverity: "high" }),
    ];
    const head = [
      fused({ targetId: "a", score: 1.5, maxSeverity: "high" }),
      fused({ targetId: "b", score: 2.0, maxSeverity: "high" }),
    ];
    const d = diffReports(base, head, "base", "head");
    expect(d.changed_hypotheses).toHaveLength(1);
    expect(d.changed_hypotheses[0].targetId).toBe("a");
    expect(d.changed_hypotheses[0].delta_score).toBeCloseTo(0.5, 4);
  });

  it("counts unchanged hypotheses (in both with same score and severity)", () => {
    const base = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "high" }),
      fused({ targetId: "b", score: 2.0, maxSeverity: "critical" }),
    ];
    const head = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "high" }),
      fused({ targetId: "b", score: 2.0, maxSeverity: "critical" }),
    ];
    const d = diffReports(base, head, "base", "head");
    expect(d.unchanged_count).toBe(2);
    expect(d.new_hypotheses).toHaveLength(0);
    expect(d.resolved_hypotheses).toHaveLength(0);
    expect(d.changed_hypotheses).toHaveLength(0);
  });

  it("sorts changed_hypotheses by |delta_score| DESC", () => {
    const base = [
      fused({ targetId: "a", score: 1.0 }),
      fused({ targetId: "b", score: 1.0 }),
      fused({ targetId: "c", score: 1.0 }),
    ];
    const head = [
      fused({ targetId: "a", score: 1.1 }), // delta = 0.1
      fused({ targetId: "b", score: 5.0 }), // delta = 4.0
      fused({ targetId: "c", score: 2.0 }), // delta = 1.0
    ];
    const d = diffReports(base, head, "base", "head");
    expect(d.changed_hypotheses.map((c) => c.targetId)).toEqual(["b", "c", "a"]);
  });

  it("handles empty base and empty head", () => {
    const d = diffReports([], [], "b", "h");
    expect(d.new_hypotheses).toHaveLength(0);
    expect(d.resolved_hypotheses).toHaveLength(0);
    expect(d.changed_hypotheses).toHaveLength(0);
    expect(d.unchanged_count).toBe(0);
    expect(d.base_count).toBe(0);
    expect(d.head_count).toBe(0);
  });

  it("produces a deterministic diff (idempotent across runs)", () => {
    const base = [
      fused({ targetId: "a", score: 1.0 }),
      fused({ targetId: "b", score: 2.0 }),
    ];
    const head = [
      fused({ targetId: "a", score: 1.0 }),
      fused({ targetId: "b", score: 2.5 }),
    ];
    const d1 = diffReports(base, head, "b", "h");
    const d2 = diffReports(base, head, "b", "h");
    expect(d1).toEqual(d2);
  });
});

/* ── diff regression scenarios (T24+ fix) ──────────────────────── */

describe("diffReports — regression scenarios", () => {
  it("detects new critical that should block CI", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const head = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "medium" }),
      fused({ targetId: "b", score: 1.5, maxSeverity: "critical" }),
    ];
    const d = diffReports(base, head, "b", "h");
    expect(d.new_hypotheses).toHaveLength(1);
    expect(d.new_hypotheses[0].targetId).toBe("b");
    expect(d.new_hypotheses[0].maxSeverity).toBe("critical");
  });

  it("detects changed that escalated from medium to critical (should block CI)", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const head = [fused({ targetId: "a", score: 1.5, maxSeverity: "critical" })];
    const d = diffReports(base, head, "b", "h");
    expect(d.changed_hypotheses).toHaveLength(1);
    expect(d.changed_hypotheses[0].base.severity).toBe("medium");
    expect(d.changed_hypotheses[0].head.severity).toBe("critical");
  });

  it("detects resolved hypotheses (improvements, do NOT block CI)", () => {
    const base = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "medium" }),
      fused({ targetId: "b", score: 1.5, maxSeverity: "critical" }),
    ];
    const head = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const d = diffReports(base, head, "b", "h");
    expect(d.resolved_hypotheses).toHaveLength(1);
    expect(d.resolved_hypotheses[0].targetId).toBe("b");
  });

  it("unchanged hypotheses: same target, same score, same severity", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "high" })];
    const head = [fused({ targetId: "a", score: 1.0, maxSeverity: "high" })];
    const d = diffReports(base, head, "b", "h");
    expect(d.unchanged_count).toBe(1);
    expect(d.new_hypotheses).toHaveLength(0);
    expect(d.resolved_hypotheses).toHaveLength(0);
    expect(d.changed_hypotheses).toHaveLength(0);
  });

  it("score-only change (same severity) is detected as changed but not as escalation", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const head = [fused({ targetId: "a", score: 1.5, maxSeverity: "medium" })];
    const d = diffReports(base, head, "b", "h");
    expect(d.changed_hypotheses).toHaveLength(1);
    expect(d.changed_hypotheses[0].delta_score).toBeCloseTo(0.5, 4);
    // Both severities are "medium" — not an escalation.
    expect(d.changed_hypotheses[0].base.severity).toBe("medium");
    expect(d.changed_hypotheses[0].head.severity).toBe("medium");
  });
});


/* ── diffExitCode (DeepSeek Critical #2 + #3) ──────────────────────── */

import { diffExitCode, InvalidSeverityError } from "../src/diff/index.js";

describe("diffExitCode", () => {
  it("regression=false on identical reports", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "high" })];
    const head = [fused({ targetId: "a", score: 1.0, maxSeverity: "high" })];
    const d = diffReports(base, head, "b", "h");
    const decision = diffExitCode(d);
    expect(decision.regression).toBe(false);
  });

  it("regression=true on new critical hypothesis", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "low" })];
    const head = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "low" }),
      fused({ targetId: "b", score: 1.5, maxSeverity: "critical" }),
    ];
    const d = diffReports(base, head, "b", "h");
    const decision = diffExitCode(d);
    expect(decision.regression).toBe(true);
    expect(decision.reason).toMatch(/new hypothesis/);
    expect(decision.reason).toMatch(/critical/);
  });

  it("regression=true on escalation from medium to high", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const head = [fused({ targetId: "a", score: 1.5, maxSeverity: "high" })];
    const d = diffReports(base, head, "b", "h");
    const decision = diffExitCode(d);
    expect(decision.regression).toBe(true);
    expect(decision.reason).toMatch(/escalation/);
  });

  it("regression=false on score-only change (same severity)", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const head = [fused({ targetId: "a", score: 1.5, maxSeverity: "medium" })];
    const d = diffReports(base, head, "b", "h");
    const decision = diffExitCode(d);
    expect(decision.regression).toBe(false);
  });

  it("regression=false on resolved high-severity hypotheses (improvements)", () => {
    const base = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "medium" }),
      fused({ targetId: "b", score: 2.0, maxSeverity: "critical" }),
    ];
    const head = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const d = diffReports(base, head, "b", "h");
    const decision = diffExitCode(d);
    expect(decision.regression).toBe(false);
  });

  it("throws InvalidSeverityError on unknown severity in new hypothesis (Critical #3)", () => {
    const base: FusedScore[] = [];
    const head: FusedScore[] = [
      fused({ targetId: "a", score: 1.0, maxSeverity: "blocker" as SeverityHint }),
    ];
    const d = diffReports(base, head, "b", "h");
    expect(() => diffExitCode(d)).toThrow(InvalidSeverityError);
    try {
      diffExitCode(d);
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSeverityError);
      expect((err as InvalidSeverityError).message).toMatch(/blocker/);
      expect((err as InvalidSeverityError).message).toMatch(/Valid values/);
    }
  });

  it("throws InvalidSeverityError on unknown severity in changed hypothesis (Critical #3)", () => {
    const base = [fused({ targetId: "a", score: 1.0, maxSeverity: "medium" })];
    const head = [fused({ targetId: "a", score: 1.5, maxSeverity: "blocker" as SeverityHint })];
    const d = diffReports(base, head, "b", "h");
    expect(() => diffExitCode(d)).toThrow(InvalidSeverityError);
  });

  it("InvalidSeverityError carries severity and where fields", () => {
    const err = new InvalidSeverityError("blocker", "test.path");
    expect(err.severity).toBe("blocker");
    expect(err.where).toBe("test.path");
    expect(err.name).toBe("InvalidSeverityError");
  });
});
