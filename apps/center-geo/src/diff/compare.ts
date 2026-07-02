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
 * Parse a FusedScore[] from a JSON report file. Supports both the
 * legacy flat-hypothesis shape and the newer report-schema shape.
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
  return obj.hypotheses.map(normalizeHypothesis);
}

const EMPTY_COMPONENTS: FusedScore["components"] = {
  geometryBonus: 0,
  independenceBonus: 0,
  boundaryBonus: 0,
  stateBonus: 0,
  cycleBonus: 0,
  testGapBonus: 0,
  contradictionPenalty: 0,
  capabilityGapPenalty: 0,
};

function normalizeHypothesis(value: unknown): FusedScore {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid hypothesis entry: not an object");
  }
  const hypothesis = value as Record<string, unknown>;
  if (typeof hypothesis.targetId === "string" && typeof hypothesis.score === "number") {
    return hypothesis as unknown as FusedScore;
  }
  const scoreObject = hypothesis.score as Record<string, unknown> | undefined;
  return {
    id: typeof hypothesis.id === "string" ? hypothesis.id : `f:${deriveTargetId(hypothesis.target)}`,
    targetId: typeof hypothesis.targetId === "string" ? hypothesis.targetId : deriveTargetId(hypothesis.target),
    targetKind: deriveTargetKind(hypothesis.targetKind, hypothesis.target),
    score: typeof scoreObject?.rank_score === "number" ? scoreObject.rank_score : 0,
    maxSeverity: typeof hypothesis.maxSeverity === "string"
      ? (hypothesis.maxSeverity as FusedScore["maxSeverity"])
      : typeof scoreObject?.severity === "string"
        ? (scoreObject.severity as FusedScore["maxSeverity"])
        : "info",
    geometries: Array.isArray(hypothesis.geometries)
      ? (hypothesis.geometries as string[])
      : Array.isArray(hypothesis.contributing_geometries)
        ? (hypothesis.contributing_geometries as string[])
        : [],
    edgeKinds: Array.isArray(hypothesis.edgeKinds) ? (hypothesis.edgeKinds as string[]) : [],
    contributors: Array.isArray(hypothesis.contributors)
      ? (hypothesis.contributors as FusedScore["contributors"])
      : [],
    components: typeof hypothesis.components === "object" && hypothesis.components !== null
      ? (hypothesis.components as FusedScore["components"])
      : EMPTY_COMPONENTS,
  };
}

function deriveTargetKind(
  explicit: unknown,
  target: unknown,
): FusedScore["targetKind"] {
  if (
    explicit === "node" ||
    explicit === "edge" ||
    explicit === "path" ||
    explicit === "subgraph" ||
    explicit === "metric" ||
    explicit === "boundary"
  ) {
    return explicit;
  }
  if (typeof target === "object" && target !== null && typeof (target as Record<string, unknown>).kind === "string") {
    const kind = (target as Record<string, unknown>).kind;
    if (
      kind === "node" ||
      kind === "edge" ||
      kind === "path" ||
      kind === "subgraph" ||
      kind === "metric" ||
      kind === "boundary"
    ) {
      return kind;
    }
  }
  return "node";
}

function deriveTargetId(target: unknown): string {
  if (typeof target !== "object" || target === null) {
    return "unknown-target";
  }
  const obj = target as Record<string, unknown>;
  if (typeof obj.node_id === "string") return obj.node_id;
  if (typeof obj.edge_id === "string") return obj.edge_id;
  if (typeof obj.boundary_id === "string") return obj.boundary_id;
  if (typeof obj.metric_name === "string") return obj.metric_name;
  if (Array.isArray(obj.node_ids) && obj.node_ids.length > 0 && typeof obj.node_ids[0] === "string") {
    return obj.node_ids.join(">");
  }
  return "unknown-target";
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

/**
 * Exit-code decision for a diff. Independent of any specific ExitCode
 * constant so the diff module can be reused by callers that have their
 * own exit-code scheme (CI, pre-commit hook, etc.). The CLI's `diff`
 * subcommand maps this to FR10's `ExitCode.THRESHOLD=1` /
 * `ExitCode.OK=0`.
 *
 * The rule (locked in by the test suite):
 *   - `regression: true`   → caller should exit non-OK (THRESHOLD).
 *   - `regression: false`  → caller should exit OK.
 *
 * Two paths to a regression:
 *   1. NEW hypothesis with severity >= high (a new critical signal).
 *   2. CHANGED hypothesis whose new severity is >= high AND whose
 *      base severity was below high (an escalation).
 *
 * RESOLVED, UNCHANGED, and CHANGED-with-stable-severity are NOT
 * regressions. A PR that only fixes issues should pass.
 */
export interface DiffExitDecision {
  regression: boolean;
  /** Human-readable reason for the decision. Useful for CI logs. */
  reason: string;
}

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const VALID_SEVERITIES = new Set(Object.keys(SEVERITY_RANK));

/**
 * Throws if a severity string isn't a known value. This is the
 * DeepSeek Critical #3 fix: a future-version `report.json` (e.g.
 * `severity: "blocker"`) was silently treated as rank 0 ("info")
 * and the regression check would pass when it shouldn't. We now
 * fail loud at diff time.
 */
export class InvalidSeverityError extends Error {
  constructor(public severity: string, public where: string) {
    super(
      `Invalid severity "${severity}" in ${where}. ` +
        `Valid values: ${[...VALID_SEVERITIES].join(", ")}. ` +
      `This is likely a future-version report that this version of ` +
      `center-geo does not understand. Update center-geo or downgrade ` +
      `the report to a compatible schema.`,
    );
    this.name = "InvalidSeverityError";
  }
}

function validateSeverity(s: string, where: string): void {
  if (!VALID_SEVERITIES.has(s)) {
    throw new InvalidSeverityError(s, where);
  }
}

export function diffExitCode(diff: DiffReport): DiffExitDecision {
  // DeepSeek Critical #3: validate every severity string before using it.
  // A hand-edited or future-version report.json with an unknown severity
  // (e.g. "blocker") would otherwise be silently treated as rank 0,
  // making the regression check pass when it should fail.
  for (const h of diff.new_hypotheses) {
    validateSeverity(h.maxSeverity, `new_hypotheses[${h.targetId}].maxSeverity`);
  }
  for (const h of diff.resolved_hypotheses) {
    validateSeverity(h.maxSeverity, `resolved_hypotheses[${h.targetId}].maxSeverity`);
  }
  for (const c of diff.changed_hypotheses) {
    validateSeverity(c.base.severity, `changed_hypotheses[${c.targetId}].base.severity`);
    validateSeverity(c.head.severity, `changed_hypotheses[${c.targetId}].head.severity`);
  }

  const newHigh = diff.new_hypotheses.find(
    (h) => SEVERITY_RANK[h.maxSeverity] >= SEVERITY_RANK.high,
  );
  if (newHigh) {
    return {
      regression: true,
      reason: `new hypothesis with severity=${newHigh.maxSeverity} (targetId=${newHigh.targetId})`,
    };
  }
  const escalated = diff.changed_hypotheses.find((c) => {
    const oldSev = SEVERITY_RANK[c.base.severity] ?? 0;
    const newSev = SEVERITY_RANK[c.head.severity] ?? 0;
    return newSev >= SEVERITY_RANK.high && oldSev < SEVERITY_RANK.high;
  });
  if (escalated) {
    return {
      regression: true,
      reason: `escalation: ${escalated.base.severity} -> ${escalated.head.severity} (targetId=${escalated.targetId})`,
    };
  }
  return { regression: false, reason: "no new or escalated high-severity hypotheses" };
}
