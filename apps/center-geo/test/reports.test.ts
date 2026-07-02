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

describe("writeJsonReport", () => {
  it("writes a JSON file with the spec-shaped report envelope and enriched hypotheses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "report.json");
      const signals = [
        sig({ id: "s1", targetId: "a", type: "high_fan_out", geometryId: "radial" }),
        sig({ id: "s2", targetId: "b", type: "boundary_violation", geometryId: "boundary" }),
      ];
      const f = [
        fused({ targetId: "a", score: 1.5, maxSeverity: "high", geometries: ["radial"], contributors: [signals[0]] }),
        fused({ targetId: "b", score: 0.5, maxSeverity: "low", geometries: ["boundary"], contributors: [signals[1]] }),
      ];
      await writeJsonReport(f, 5, 2, out, coverage, reportMeta);
      const raw = await readFile(out, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.schema_version).toBe("1.0.0");
      expect(parsed.count).toBe(2);
      expect(parsed.raw_signal_count).toBe(2);
      expect(parsed.tool_version).toBe("0.1.0");
      expect(parsed.scan_frame.root).toBe(".");
      expect(parsed.scan_frame.config_hash).toBe("cfg123");
      expect(parsed.engine_runs).toEqual([{ geometry_id: "radial", status: "completed" }]);
      expect(parsed.signals).toEqual([]);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.hypotheses).toHaveLength(2);
      expect(parsed.hypotheses[0].targetId).toBe("a");
      expect(parsed.hypotheses[0].title).toBeDefined();
      expect(parsed.hypotheses[0].status).toBe("hypothesis");
      expect(parsed.hypotheses[0].target).toBeDefined();
      expect(parsed.hypotheses[0].contributing_signal_ids).toEqual(["s1"]);
      expect(parsed.hypotheses[0].contributing_geometries).toEqual(["radial"]);
      expect(parsed.hypotheses[0].score.rank_score).toBe(1.5);
      expect(parsed.hypotheses[0].score.severity).toBe("high");
      expect(Array.isArray(parsed.hypotheses[0].limitations)).toBe(true);
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
      await writeJsonReport(f, 2, 3, out, coverage, reportMeta);
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
      await writeJsonReport([fused({ targetId: "a" })], 5, 1, out, coverage, reportMeta);
      const parsed = JSON.parse(await readFile(out, "utf-8"));
      expect(parsed.schema_version).toBe("1.0.0");
      expect(parsed.tool_version).toBe("0.1.0");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

/* ── Markdown report (T18) ──────────────────────────────────────── */

describe("writeMarkdownReport", () => {
  it("writes a markdown file with the required report sections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cg-report-"));
    try {
      const out = join(dir, "report.md");
      const f = [
        fused({ targetId: "a", score: 1.25, maxSeverity: "critical", geometries: ["anomaly", "radial"] }),
      ];
      await writeMarkdownReport(f, 5, 3, "0.1.0", out, {
        ...reportMeta,
        coverage,
      });
      const md = await readFile(out, "utf-8");
      expect(md).toContain("# CENTER-MULTIGEOMETRY Report");
      expect(md).toContain("These are structural risk hypotheses derived from graph evidence.");
      expect(md).toContain("## Executive summary");
      expect(md).toContain("## Scan frame");
      expect(md).toContain("## Coverage and extraction gaps");
      expect(md).toContain("## Top hypotheses");
      expect(md).toContain("## Geometry summaries");
      expect(md).toContain("## Boundary findings");
      expect(md).toContain("## Cycle findings");
      expect(md).toContain("## Anomaly-only leads");
      expect(md).toContain("## Convergent dependencies");
      expect(md).toContain("## Agent investigation packets");
      expect(md).toContain("## Non-goals and limitations");
      expect(md).toContain("## Appendix: config hash and engine versions");
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
      await writeMarkdownReport(f, 2, 3, "0.1.0", out, {
        ...reportMeta,
        coverage,
      });
      const md = await readFile(out, "utf-8");
      expect(md).toContain("## Top hypotheses");
      expect(md).toContain("### H001");
      expect(md).toContain("### H002");
      expect(md).not.toContain("### H003");
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
