/**
 * Diff mode (T24).
 *
 * Compare two FusedScore[] reports and produce a diff:
 *   - new: hypotheses in <b> not in <a>
 *   - resolved: hypotheses in <a> not in <b>
 *   - changed: hypotheses in both but with a different score or severity
 *   - unchanged: hypotheses in both with the same score + severity
 *
 * Identification: by targetId (the canonical hypothesis key).
 *
 * Output: a JSON diff report. Designed to be machine-parseable for
 * CI annotation (e.g. "this PR added 3 new critical signals and
 * resolved 1").
 */

import { readFile } from "node:fs/promises";
import type { FusedScore } from "../scoring/types.js";

export interface DiffReport {
  schema_version: "1.0.0";
  base_path: string;
  head_path: string;
  base_count: number;
  head_count: number;
  new_hypotheses: FusedScore[];
  resolved_hypotheses: FusedScore[];
  changed_hypotheses: Array<{
    targetId: string;
    base: { score: number; severity: string };
    head: { score: number; severity: string };
    delta_score: number;
  }>;
  unchanged_count: number;
}

export type FusedScoreById = Map<string, FusedScore>;

/**
 * Parse a FusedScore[] from a JSON report file. The file may be either:
 *   - the raw stdout JSON (has 'hypotheses' top-level key), or
 *   - the saved report.json (also has 'hypotheses' top-level key).
 *
 * Throws if the file is not a valid report.
 */
export async function readReport(path: string): Promise<FusedScore[]> {
  const raw = await readFile(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid report at ${path}: not an object`);
  }
  const obj = parsed as { hypotheses?: unknown };
  if (!Array.isArray(obj.hypotheses)) {
    throw new Error(`Invalid report at ${path}: missing 'hypotheses' array`);
  }
  return obj.hypotheses as FusedScore[];
}

/**
 * Build a FusedScore index keyed by targetId.
 */
function indexByTargetId(arr: readonly FusedScore[]): FusedScoreById {
  const m = new Map<string, FusedScore>();
  for (const h of arr) {
    m.set(h.targetId, h);
  }
  return m;
}

/**
 * Compute the diff between two FusedScore[] reports.
 */
export function diffReports(
  base: readonly FusedScore[],
  head: readonly FusedScore[],
  basePath: string,
  headPath: string,
): DiffReport {
  const baseIdx = indexByTargetId(base);
  const headIdx = indexByTargetId(head);

  const newHyp: FusedScore[] = [];
  const resolvedHyp: FusedScore[] = [];
  const changedHyp: DiffReport["changed_hypotheses"] = [];
  let unchanged = 0;

  // Walk the head: anything in head not in base is "new".
  // Anything in both is "changed" or "unchanged".
  for (const [id, headH] of headIdx) {
    const baseH = baseIdx.get(id);
    if (!baseH) {
      newHyp.push(headH);
    } else if (baseH.score !== headH.score || baseH.maxSeverity !== headH.maxSeverity) {
      changedHyp.push({
        targetId: id,
        base: { score: baseH.score, severity: baseH.maxSeverity },
        head: { score: headH.score, severity: headH.maxSeverity },
        delta_score: +(headH.score - baseH.score).toFixed(4),
      });
    } else {
      unchanged++;
    }
  }

  // Walk the base: anything in base not in head is "resolved".
  for (const [id, baseH] of baseIdx) {
    if (!headIdx.has(id)) {
      resolvedHyp.push(baseH);
    }
  }

  // Sort by score DESC for stable output.
  newHyp.sort((a, b) => b.score - a.score);
  resolvedHyp.sort((a, b) => b.score - a.score);
  changedHyp.sort((a, b) => Math.abs(b.delta_score) - Math.abs(a.delta_score));

  return {
    schema_version: "1.0.0",
    base_path: basePath,
    head_path: headPath,
    base_count: base.length,
    head_count: head.length,
    new_hypotheses: newHyp,
    resolved_hypotheses: resolvedHyp,
    changed_hypotheses: changedHyp,
    unchanged_count: unchanged,
  };
}
