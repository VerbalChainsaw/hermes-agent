/**
 * JSON report writer (T17).
 *
 * Writes the top-N report envelope to a JSON file in the output directory.
 * Shape matches the stdout `--format json` output for consistency.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { FusedScore } from "../scoring/types.js";
import {
  buildJsonReport,
  type CoverageReport,
  type ReportMeta,
} from "./model.js";

/**
 * Write the JSON report to `outputPath`. The directory is created
 * if it does not exist. The file is overwritten if it does.
 */
export async function writeJsonReport(
  fused: readonly FusedScore[],
  topN: number,
  rawSignalCount: number,
  outputPath: string,
  coverage: CoverageReport,
  meta?: Partial<ReportMeta>,
): Promise<void> {
  const report = buildJsonReport(fused, topN, rawSignalCount, coverage, meta);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
}
