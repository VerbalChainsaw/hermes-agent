/**
 * Output formatting (T15).
 *
 * Two formats:
 *   - "human": human-readable summary to stderr (existing behavior).
 *   - "json":  machine-readable JSON to stdout (new).
 *
 * The JSON shape is the FusedScore[] (top-N) plus a small header with
 * the run's metadata. Stable, parseable, versioned.
 */

import type { FusedScore } from "../scoring/types.js";

export type OutputFormat = "human" | "json";

/** Snapshot-level coverage metadata. Computed by the scan pipeline
 *  and exposed in the report so users can see "how much of the repo
 *  was actually scanned" — a missing or mis-computed value here is
 *  what DeepSeek Critical #1 caught (the old code computed
 *  files_parsed = allNodes.length - parseWarnings.length, which is
 *  meaningless because allNodes includes symbol nodes too). */
export interface CoverageReport {
  /** Total files matching the include/exclude globs. */
  files_seen: number;
  /** Files that parsed successfully (parseFile returned ok). */
  files_parsed: number;
  /** Files that failed to parse (syntax error, IO error, or internal_error). */
  files_failed: number;
  /** Edges where confidence is "low" or "unknown" (T07+ signal). */
  edges_low_confidence: number;
  /** Wall-clock milliseconds spent in the parse step. 0 if not measured. */
  parse_ms: number;
}

/** Top-level JSON shape emitted to stdout in `--format json` mode. */
export interface JsonReport {
  /** Schema version for this report format. Bump on incompatible changes. */
  schema_version: "1.0.0";
  /** Total fused hypotheses emitted in this report. */
  count: number;
  /** Number of raw signals that fed fusion. */
  raw_signal_count: number;
  /** Coverage metadata for the scan that produced this report. */
  coverage: CoverageReport;
  /** The top-N hypotheses, in score-DESC order. */
  hypotheses: FusedScore[];
}

/**
 * Format `fused` (the full FusedScore[]) as a JSON string for stdout
 * consumption. Top-N is enforced here so the caller doesn't have to
 * pre-slice.
 */
export function formatJson(
  fused: readonly FusedScore[],
  topN: number,
  rawSignalCount: number,
  coverage: CoverageReport,
): string {
  const top = fused.slice(0, topN);
  const report: JsonReport = {
    schema_version: "1.0.0",
    count: top.length,
    raw_signal_count: rawSignalCount,
    coverage,
    hypotheses: top,
  };
  return JSON.stringify(report, null, 2) + "\n";
}

/**
 * Format `fused` as a human-readable summary, one line per hypothesis.
 * Used by `--format human` (default).
 */
export function formatHuman(
  fused: readonly FusedScore[],
  topN: number,
): string {
  const top = fused.slice(0, topN);
  const lines: string[] = [];
  if (top.length === 0) {
    lines.push("(no fused hypotheses)");
    return lines.join("\n") + "\n";
  }
  // Severity column width is fixed at 9 chars to accommodate
  // "critical" (the longest of the 5 known severities:
  // info=4, low=3, medium=6, high=4, critical=8). Hardcoded so
  // future longer severities don't break column alignment.
  // (DeepSeek Minor #3: padEnd(8) breaks for localized or longer
  // severity strings. Use a fixed width based on the longest known
  // value.)
  const SEVERITY_WIDTH = 9;
  for (const h of top) {
    lines.push(
      `score=${h.score.toFixed(2)} ${h.maxSeverity.padEnd(SEVERITY_WIDTH)} ${h.targetKind} -> ${h.targetId}  [${h.geometries.join(",")}]`,
    );
  }
  if (fused.length > top.length) {
    lines.push(`... and ${fused.length - top.length} more`);
  }
  return lines.join("\n") + "\n";
}