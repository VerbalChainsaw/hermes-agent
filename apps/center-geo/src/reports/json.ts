/**
 * JSON report writer (T17).
 *
 * Writes the top-N FusedScore[] to a JSON file in the output directory.
 * Shape matches the stdout `--format json` output (T15) for consistency.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { FusedScore } from "../scoring/types.js";

/**
 * Write the JSON report to `outputPath`. The directory is created
 * if it does not exist. The file is overwritten if it does.
 */
export async function writeJsonReport(
  fused: readonly FusedScore[],
  topN: number,
  rawSignalCount: number,
  outputPath: string,
): Promise<void> {
  const top = fused.slice(0, topN);
  const report = {
    schema_version: "1.0.0" as const,
    count: top.length,
    raw_signal_count: rawSignalCount,
    hypotheses: top,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
}