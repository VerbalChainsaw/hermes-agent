import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonReport } from "../src/reports/json.js";
import { writeMarkdownReport } from "../src/reports/markdown.js";
import { writeSarifReport, toSarif } from "../src/reports/sarif.js";
import type { FusedScore } from "../src/scoring/types.js";
import type { Signal } from "../src/engines/radial/signals.js";

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

function sig(input: Partial<Signal> & { id: string; targetId: string; type: string; geometryId: string }): Signal {
  return {
    severityHint: "medium",
    confidenceHint: "high",
    targetKind: "node",
    anchors: [{ path: "src/foo.ts", range: { start_line: 1, end_line: 1 }, symbol: "foo", source: "source" }],
    metrics: {},
    metadata: {},
    limitations: [],
    ...input,
  } as Signal;
}

/* ── JSON report (T17) ─────────────────────────────────────────── */

describe("writeJsonReport", () => {
  it("writes a JSON file with schema_version, count, hypotheses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "report.json");
      const signals = [
        sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
        sig({ id: "s2", targetId: "b", type: "boundary_violation", geometryId: "boundary" }),
      ];
      const f = [
        fused({ targetId: "a", score: 1.5, maxSeverity: "high", contributors: [signals[0]] }),
        fused({ targetId: "b", score: 0.5, maxSeverity: "low", contributors: [signals[1]] }),
      ];
      await writeJsonReport(f, 5, 2, out);
      const raw = await readFile(out, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.schema_version).toBe("1.0.0");
      expect(parsed.count).toBe(2);
      expect(parsed.raw_signal_count).toBe(2);
      expect(parsed.hypotheses).toHaveLength(2);
      expect(parsed.hypotheses[0].targetId).toBe("a");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("caps hypotheses at topN", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "report.json");
      const f = [
        fused({ targetId: "a", score: 2 }),
        fused({ targetId: "b", score: 1 }),
        fused({ targetId: "c", score: 0.5 }),
      ];
      await writeJsonReport(f, 2, 3, out);
      const parsed = JSON.parse(await readFile(out, "utf-8"));
      expect(parsed.count).toBe(2);
      expect(parsed.hypotheses).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("creates parent directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "nested", "deep", "report.json");
      await writeJsonReport([fused({ targetId: "a" })], 5, 1, out);
      const parsed = JSON.parse(await readFile(out, "utf-8"));
      expect(parsed.schema_version).toBe("1.0.0");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

/* ── Markdown report (T18) ──────────────────────────────────────── */

describe("writeMarkdownReport", () => {
  it("writes a markdown file with header, table, and limitations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "report.md");
      const f = [
        fused({ targetId: "a", score: 1.25, maxSeverity: "critical", geometries: ["anomaly", "radial"] }),
      ];
      await writeMarkdownReport(f, 5, 3, "0.1.0", out);
      const md = await readFile(out, "utf-8");
      expect(md).toContain("# CENTER-MULTIGEOMETRY Report");
      expect(md).toContain("Tool version: 0.1.0");
      expect(md).toContain("Raw signals: 3");
      expect(md).toContain("| Rank | Score | Severity |");
      expect(md).toContain("| 1 | 1.25 | critical |");
      expect(md).toContain("`a`");
      expect(md).toContain("anomaly, radial");
      expect(md).toContain("## Limitations");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("respects topN cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "report.md");
      const f = [
        fused({ targetId: "a", score: 2 }),
        fused({ targetId: "b", score: 1 }),
        fused({ targetId: "c", score: 0.5 }),
      ];
      await writeMarkdownReport(f, 2, 3, "0.1.0", out);
      const md = await readFile(out, "utf-8");
      expect(md).toContain("| 1 | 2.00");
      expect(md).toContain("| 2 | 1.00");
      expect(md).not.toContain("| 3 |");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

/* ── SARIF report (T19) ─────────────────────────────────────────── */

describe("toSarif (pure transform)", () => {
  it("produces valid SARIF 2.1.0 structure", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
    ];
    const f = [
      fused({ targetId: "a", score: 1.5, maxSeverity: "critical", contributors: signals }),
    ];
    const r = toSarif(f, 5, "center-geo", "0.1.0");
    expect(r.$schema).toContain("sarif");
    expect(r.version).toBe("2.1.0");
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].tool.driver.name).toBe("center-geo");
    expect(r.runs[0].tool.driver.version).toBe("0.1.0");
    expect(r.runs[0].results).toHaveLength(1);
  });

  it("maps SeverityHint to SARIF level", () => {
    const f = [
      fused({ targetId: "a", score: 1, maxSeverity: "info" }),
      fused({ targetId: "b", score: 1, maxSeverity: "low" }),
      fused({ targetId: "c", score: 1, maxSeverity: "medium" }),
      fused({ targetId: "d", score: 1, maxSeverity: "high" }),
      fused({ targetId: "e", score: 1, maxSeverity: "critical" }),
    ];
    const r = toSarif(f, 5, "center-geo", "0.1.0");
    const levels = r.runs[0].results.map((res) => res.level);
    expect(levels).toEqual(["note", "warning", "warning", "error", "error"]);
  });

  it("creates one rule per (geometry x signal type) combo", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
      sig({ id: "s2", targetId: "a", type: "fan_out_anomaly", geometryId: "anomaly" }),
    ];
    const f = [
      fused({ targetId: "a", score: 1.5, maxSeverity: "high", contributors: signals }),
    ];
    const r = toSarif(f, 5, "center-geo", "0.1.0");
    expect(r.runs[0].tool.driver.rules).toHaveLength(2);
    expect(r.runs[0].tool.driver.rules.map((ru) => ru.id).sort()).toEqual([
      "anomaly/fan_out_anomaly",
      "radial/high_fan_out",
    ]);
  });

  it("uses physicalLocation when path is present", () => {
    const signals = [
      sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
    ];
    const f = [
      fused({ targetId: "a", score: 1, maxSeverity: "low", contributors: signals }),
    ];
    const r = toSarif(f, 5, "center-geo", "0.1.0");
    const loc = r.runs[0].results[0].locations[0];
    if (!("physicalLocation" in loc)) {
      throw new Error("expected physicalLocation");
    }
    expect(loc.physicalLocation.artifactLocation.uri).toBe("src/foo.ts");
  });

  it("uses logicalLocation when no physical path is available", () => {
    const noPathSignal: Signal = {
      id: "s1",
      targetId: "a",
      type: "high_fan_out",
      geometryId: "radial",
      severityHint: "low",
      confidenceHint: "low",
      targetKind: "node",
      anchors: [],
      metrics: {},
      metadata: {},
      limitations: [],
    };
    const f = [
      fused({ targetId: "a", score: 1, maxSeverity: "low", contributors: [noPathSignal] }),
    ];
    const r = toSarif(f, 5, "center-geo", "0.1.0");
    const loc = r.runs[0].results[0].locations[0];
    if (!("logicalLocation" in loc)) {
      throw new Error("expected logicalLocation");
    }
    expect(loc.logicalLocation.name).toBe("a");
  });
});

describe("writeSarifReport", () => {
  it("writes a SARIF JSON file to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "report.sarif");
      const signals = [
        sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
      ];
      const f = [
        fused({ targetId: "a", score: 1, maxSeverity: "high", contributors: signals }),
      ];
      await writeSarifReport(f, 5, "center-geo", "0.1.0", out);
      const raw = await readFile(out, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe("2.1.0");
      expect(parsed.runs[0].tool.driver.name).toBe("center-geo");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
