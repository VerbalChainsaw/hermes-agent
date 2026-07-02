/**
 * Output formatting (T15).
 *
 * Two formats:
 *   - "human": human-readable summary to stderr (existing behavior).
 *   - "json":  machine-readable JSON to stdout (spec-shaped report envelope).
 */

import type { FusedScore } from "../scoring/types.js";
import {
  buildJsonReport,
  type CoverageReport,
  type JsonReport,
  type ReportMeta,
} from "../reports/model.js";

export type OutputFormat = "human" | "json";
export type { CoverageReport, JsonReport, ReportMeta };

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
  meta?: Partial<ReportMeta>,
): string {
  const report = buildJsonReport(fused, topN, rawSignalCount, coverage, meta);
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
