/**
 * Markdown report writer (T18).
 *
 * Writes a human-readable markdown summary to `outputPath`. Designed
 * to render nicely in GitHub PR comments, code review bots, and
 * terminal markdown viewers (glamour-style).
 *
 * Format:
 *   # CENTER-MULTIGEOMETRY Report
 *
 *   Schema version: 1.0.0
 *   Raw signals: 35
 *   Fused hypotheses: 26
 *   Top N shown: 20
 *
 *   ## Top hypotheses by fused score
 *
 *   | Rank | Score | Severity | Target | Geometries |
 *   | ---- | ----- | -------- | ------ | ---------- |
 *   | 1    | 1.25  | critical | file:0bd4c... | anomaly,radial |
 *   | ...
 *
 *   ## Limitations
 *   - Signals are hypotheses, not defects (per docs/01 §G4).
 *   - Severity scale is heuristic, not calibrated.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { FusedScore } from "../scoring/types.js";

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
): Promise<void> {
  const top = fused.slice(0, topN);

  const lines: string[] = [];
  lines.push(`# CENTER-MULTIGEOMETRY Report`);
  lines.push("");
  lines.push(`Schema version: 1.0.0`);
  lines.push(`Tool version: ${toolVersion}`);
  lines.push(`Raw signals: ${rawSignalCount}`);
  lines.push(`Fused hypotheses: ${fused.length}`);
  lines.push(`Top N shown: ${top.length}`);
  lines.push("");
  lines.push(`## Top hypotheses by fused score`);
  lines.push("");
  lines.push(`| Rank | Score | Severity | Target | Geometries |`);
  lines.push(`| ---- | ----- | -------- | ------ | ---------- |`);
  for (let i = 0; i < top.length; i++) {
    const h = top[i];
    lines.push(
      `| ${i + 1} | ${h.score.toFixed(2)} | ${h.maxSeverity} | \`${h.targetId}\` | ${h.geometries.join(", ")} |`,
    );
  }
  lines.push("");
  lines.push(`## Limitations`);
  lines.push("");
  lines.push(`- Signals are HYPOTHESES, not defects (per docs/01 §G4).`);
  lines.push(`- Severity scale is heuristic; not calibrated against historical defect rates.`);
  lines.push(`- Static analysis only — runtime metrics are not measured.`);
  lines.push(`- Fusion formula weights are configurable; results depend on \`config.scoring\`.`);
  lines.push("");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join("\n"), "utf-8");
}