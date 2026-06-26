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

/** Top-level JSON shape emitted to stdout in `--format json` mode. */
export interface JsonReport {
  /** Schema version for this report format. Bump on incompatible changes. */
  schema_version: "1.0.0";
  /** Total fused hypotheses emitted in this report. */
  count: number;
  /** Number of raw signals that fed fusion. */
  raw_signal_count: number;
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
): string {
  const top = fused.slice(0, topN);
  const report: JsonReport = {
    schema_version: "1.0.0",
    count: top.length,
    raw_signal_count: rawSignalCount,
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
  for (const h of top) {
    lines.push(
      `score=${h.score.toFixed(2)} ${h.maxSeverity.padEnd(8)} ${h.targetKind} -> ${h.targetId}  [${h.geometries.join(",")}]`,
    );
  }
  if (fused.length > top.length) {
    lines.push(`... and ${fused.length - top.length} more`);
  }
  return lines.join("\n") + "\n";
}