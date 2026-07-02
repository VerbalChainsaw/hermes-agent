/**
 * Markdown report writer (T18).
 *
 * Writes a human-readable markdown summary to `outputPath`.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { FusedScore } from "../scoring/types.js";
import {
  buildJsonReport,
  type CoverageReport,
  type ReportHypothesis,
  type ReportMeta,
} from "./model.js";

const EMPTY_COVERAGE: CoverageReport = {
  files_seen: 0,
  files_parsed: 0,
  files_indexed: 0,
  files_skipped: 0,
  files_failed: 0,
  nodes_total: 0,
  edges_total: 0,
  unsupported_files: 0,
  generated_files: 0,
  parse_failure_paths: [],
  edges_low_confidence: 0,
  parse_ms: 0,
  graph_build_ms: 0,
};

/**
 * Write the markdown report to `outputPath`. The directory is created
 * if it does not exist.
 */
export async function writeMarkdownReport(
  fused: readonly FusedScore[],
  topN: number,
  rawSignalCount: number,
  toolVersion: string,
  outputPath: string,
  context?: Partial<ReportMeta> & { coverage?: CoverageReport },
): Promise<void> {
  const coverage = context?.coverage ?? EMPTY_COVERAGE;
  const report = buildJsonReport(fused, topN, rawSignalCount, coverage, {
    ...(context ?? {}),
    toolVersion,
  });
  const top = report.hypotheses;
  const lines: string[] = [];

  lines.push("# CENTER-MULTIGEOMETRY Report");
  lines.push("");
  lines.push("These are structural risk hypotheses derived from graph evidence. They are not confirmed defects until reproduced or proven by a focused audit.");
  lines.push("");

  lines.push("## Executive summary");
  lines.push("");
  lines.push(`- Files indexed: ${report.coverage.files_indexed}`);
  lines.push(`- Parse failures: ${report.coverage.files_failed}`);
  lines.push(`- Engines run: ${formatEngineList(report.engine_runs)}`);
  lines.push(`- Highest hypothesis severity: ${top[0]?.score.severity ?? "none"}`);
  lines.push("");

  lines.push("## Scan frame");
  lines.push("");
  lines.push(`- Mode: ${report.scan_frame.mode}`);
  lines.push("- Root: current scan target (exact path is carried in JSON output)");
  lines.push(`- Graph id: ${report.scan_frame.graph_id ?? "unknown"}`);
  lines.push(`- Config hash: ${report.scan_frame.config_hash}`);
  lines.push(`- Revision: ${formatRevision(report.scan_frame.revision)}`);
  lines.push("");

  lines.push("## Coverage and extraction gaps");
  lines.push("");
  lines.push(`- Files seen: ${report.coverage.files_seen}`);
  lines.push(`- Files indexed: ${report.coverage.files_indexed}`);
  lines.push(`- Files skipped: ${report.coverage.files_skipped}`);
  lines.push(`- Files failed: ${report.coverage.files_failed}`);
  lines.push(`- Nodes total: ${report.coverage.nodes_total}`);
  lines.push(`- Edges total: ${report.coverage.edges_total}`);
  if (report.coverage.parse_failure_paths.length === 0) {
    lines.push("- Extraction gaps: none recorded");
  } else {
    lines.push("- Extraction gaps:");
    for (const path of report.coverage.parse_failure_paths) {
      lines.push(`  - ${path}`);
    }
  }
  lines.push("");

  lines.push("## Top hypotheses");
  lines.push("");
  if (top.length === 0) {
    lines.push("None.");
    lines.push("");
  } else {
    top.forEach((hypothesis, index) => {
      lines.push(...formatHypothesis(hypothesis, index));
    });
  }

  lines.push("## Geometry summaries");
  lines.push("");
  if (report.engine_runs.length === 0) {
    lines.push("None.");
  } else {
    for (const engine of report.engine_runs) {
      lines.push(`- ${engine.geometry_id}: ${engine.status}${typeof engine.signal_count === "number" ? ` (${engine.signal_count} signals)` : ""}`);
    }
  }
  lines.push("");

  lines.push("## Boundary findings");
  lines.push("");
  lines.push(...formatFilteredTitles(top, (hypothesis) => hypothesis.contributing_geometries.includes("boundary")));
  lines.push("");

  lines.push("## Cycle findings");
  lines.push("");
  lines.push(...formatFilteredTitles(top, (hypothesis) => hypothesis.contributing_geometries.includes("cycle")));
  lines.push("");

  lines.push("## Anomaly-only leads");
  lines.push("");
  lines.push(...formatFilteredTitles(top, (hypothesis) => hypothesis.contributing_geometries.length === 1 && hypothesis.contributing_geometries[0] === "anomaly"));
  lines.push("");

  lines.push("## Convergent dependencies");
  lines.push("");
  lines.push(...formatFilteredTitles(top, (hypothesis) => hypothesis.contributing_geometries.includes("convergent")));
  lines.push("");

  lines.push("## Agent investigation packets");
  lines.push("");
  if (top.length === 0) {
    lines.push("None.");
    lines.push("");
  } else {
    top.forEach((hypothesis, index) => {
      const label = hypothesisLabel(index);
      lines.push(`### Packet ${label}`);
      lines.push("");
      lines.push(`- Objective: ${hypothesis.investigation_packet.objective}`);
      lines.push(`- Suspected invariant: ${hypothesis.investigation_packet.suspected_invariant}`);
      if (hypothesis.investigation_packet.first_questions.length > 0) {
        lines.push(`- First question: ${hypothesis.investigation_packet.first_questions[0]}`);
      }
      lines.push("");
    });
  }

  lines.push("## Non-goals and limitations");
  lines.push("");
  lines.push("- CENTER-MULTIGEOMETRY ranks investigation targets; it does not confirm defects.");
  lines.push("- Static graph extraction cannot see runtime-only behavior, dynamic dispatch resolution, or environment-specific wiring unless another tool verifies it.");
  lines.push("- Report shape is deterministic; interpretation still requires human judgment or a focused audit.");
  lines.push("");

  lines.push("## Appendix: config hash and engine versions");
  lines.push("");
  lines.push(`- Tool version: ${report.tool_version}`);
  lines.push(`- Config hash: ${report.scan_frame.config_hash}`);
  lines.push(`- Engine statuses: ${report.engine_runs.map((engine) => `${engine.geometry_id}=${engine.status}`).join(", ") || "none"}`);
  lines.push("");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join("\n"), "utf-8");
}

function hypothesisLabel(index: number): string {
  return `H${String(index + 1).padStart(3, "0")}`;
}

function formatHypothesis(hypothesis: ReportHypothesis, index: number): string[] {
  const label = hypothesisLabel(index);
  const lines: string[] = [];
  lines.push(`### ${label} - ${hypothesis.title}`);
  lines.push("");
  lines.push(`Status: ${hypothesis.status}`);
  lines.push(`Severity hint: ${hypothesis.score.severity}`);
  lines.push(`Confidence: ${hypothesis.score.confidence}`);
  lines.push(`Contributing geometries: ${hypothesis.contributing_geometries.join(", ") || "none"}`);
  lines.push("");
  lines.push("Why this surfaced:");
  lines.push("");
  for (const note of hypothesis.score.calculation_notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("Evidence anchors:");
  lines.push("");
  const anchors = hypothesis.investigation_packet.suggested_center_anchors;
  if (anchors.length === 0) {
    lines.push("- None captured.");
  } else {
    for (const anchor of anchors) {
      if (anchor.range) {
        lines.push(`- ${anchor.path}:${anchor.range.start_line}-${anchor.range.end_line}`);
      } else {
        lines.push(`- ${anchor.path}`);
      }
    }
  }
  lines.push("");
  lines.push("Limitations:");
  lines.push("");
  for (const limitation of hypothesis.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push("");
  lines.push("Suggested CENTER-AUDIT seed:");
  lines.push("");
  lines.push(`- Center: ${hypothesis.targetId}`);
  lines.push(`- Suspected invariant: ${hypothesis.investigation_packet.suspected_invariant}`);
  lines.push(`- First question: ${hypothesis.investigation_packet.first_questions[0] ?? "Verify the strongest contributor and falsify it if possible."}`);
  lines.push("");
  return lines;
}

function formatFilteredTitles(
  hypotheses: readonly ReportHypothesis[],
  predicate: (hypothesis: ReportHypothesis) => boolean,
): string[] {
  const matches = hypotheses.filter(predicate);
  if (matches.length === 0) {
    return ["None."];
  }
  return matches.map((hypothesis) => `- ${hypothesis.title}`);
}

function formatEngineList(engineRuns: readonly { geometry_id: string; status: string }[]): string {
  const completed = engineRuns.filter((engine) => engine.status === "completed").map((engine) => engine.geometry_id);
  return completed.length > 0 ? completed.join(", ") : "none";
}

function formatRevision(revision: ReportMeta["scanFrame"]["revision"]): string {
  if (!revision) return "unknown";
  if (revision.vcs === "git") {
    const commit = revision.commit ? revision.commit.slice(0, 12) : "unknown";
    const branch = revision.branch ? ` on ${revision.branch}` : "";
    return `git ${commit}${branch}`;
  }
  if (revision.vcs === "none") {
    return revision.snapshot_hash ? `snapshot ${revision.snapshot_hash}` : "none";
  }
  return "unknown";
}
