/**
 * Signal type — the unit emitted by geometry engines (T09+).
 *
 * Per docs/01 §FR7, every signal must include:
 *   - signal id
 *   - geometry id (which engine produced it)
 *   - signal type (per-engine vocabulary)
 *   - target kind (node, edge, path, subgraph, metric, boundary)
 *   - evidence anchors (with line ranges)
 *   - severity hint (informational; not a defect claim)
 *   - confidence hint
 *   - raw metrics
 *   - limitations
 *
 * A signal is a hypothesis, not a defect. Per docs/01 §G3 + docs/09
 * §10, signals must never be reported as "confirmed defects" — that's
 * center-audit's job, not center-geo's.
 */

import { createHash } from "node:crypto";

import type { Anchor, Confidence, EdgeKind, GraphNode } from "../../graph/index.js";

/**
 * What kind of thing the signal points at. The fusion layer (T15)
 * groups signals by target.
 */
export type SignalTargetKind = "node" | "edge" | "path" | "subgraph" | "metric" | "boundary";

/**
 * Severity hint. Informational only — does NOT mean "defect".
 * Fusion (T15) combines severity + confidence + scoring config to
 * produce a final rank; raw severity alone is never a claim.
 */
export type SeverityHint = "info" | "low" | "medium" | "high" | "critical";

/**
 * Per-engine signal type vocabulary. Each engine defines its own
 * subset. The radial engine uses:
 *   - "high_fan_out" — a node has many outgoing edges (potential
 *     architectural bottleneck / coupling risk)
 *   - "broad_blast_radius" — a node is reachable from many seeds
 *   - "boundary_reached" — BFS reached the configured max_depth
 *
 * Other engines (T10+) will define their own. Keeping this as a
 * string union so the type system enforces exhaustiveness.
 */
export type RadialSignalType = "high_fan_out" | "broad_blast_radius" | "boundary_reached";

export type SignalType = RadialSignalType | string; // open-ended for future engines

export interface Signal {
  /** Stable id: `s:<kind>:<target>:<16-hex-sha256>`. */
  id: string;
  /** Which engine produced this signal (e.g. "radial"). */
  geometryId: "radial" | "cycle" | "boundary" | "anomaly" | "convergent";
  /** Engine-specific signal type. */
  type: SignalType;
  /** What the signal points at. */
  targetKind: SignalTargetKind;
  /** Target id (node id, edge id, path sig, etc.). */
  targetId: string;
  /** Evidence anchors. */
  anchors: Anchor[];
  /** Severity hint. NOT a defect claim. */
  severityHint: SeverityHint;
  /** Confidence hint. */
  confidenceHint: Confidence;
  /** Raw metrics (fan-out count, depth reached, etc.). */
  metrics: Record<string, number>;
  /** Free-form metadata. */
  metadata: Record<string, unknown>;
  /** Engine-specific limitations (what this signal cannot prove). */
  limitations: string[];
}

/**
 * Generate a stable signal id. Format: `s:<geometry>:<type>:<target>:<hash>`.
 * The hash is over the canonical target+type+geometry signature so two
 * engines on the same store produce identical ids for the same signal.
 */
export function makeSignalId(input: {
  geometryId: Signal["geometryId"];
  type: Signal["type"];
  targetId: string;
  metrics?: Record<string, number>;
}): string {
  const sig = `${input.geometryId}\u0000${input.type}\u0000${input.targetId}\u0000${
    JSON.stringify(input.metrics ?? {}, Object.keys(input.metrics ?? {}).sort())
  }`;
  const hash = createHash("sha256").update(sig).digest("hex").slice(0, 16);
  return `s:${input.geometryId}:${input.type}:${input.targetId}:${hash}`;
}

/* ── Allowed-edge-kinds filtering helper ─────────────────────────── */

/**
 * Returns true if the given edge kind is allowed by the engine config.
 * If `allowedEdgeKinds` is undefined OR empty, all edge kinds are allowed.
 * If non-empty, only those edge kinds are allowed.
 *
 * Note: we treat undefined AND empty array the same — both mean "no
 * restriction." This matters because the radial engine defaults
 * `allowedEdgeKinds` to `[]` when the config field is absent, and we
 * don't want an empty allow-list to silently filter out everything.
 */
export function isEdgeKindAllowed(
  kind: EdgeKind,
  allowedEdgeKinds: readonly EdgeKind[] | undefined,
): boolean {
  if (!allowedEdgeKinds || allowedEdgeKinds.length === 0) return true;
  return allowedEdgeKinds.includes(kind);
}

/* ── Node-tag helpers for boundary detection ──────────────────── */

/**
 * Returns true if the node carries any tag from the boundary tags
 * declared in the config. Used by the radial engine's boundary_reached
 * signal: when BFS reaches a node tagged as a boundary (e.g. "ui",
 * "api", "persistence"), the engine emits a boundary_reached signal.
 */
export function nodeHasBoundaryTag(
  node: GraphNode,
  boundaryTagNames: readonly string[] | undefined,
): boolean {
  if (!boundaryTagNames || boundaryTagNames.length === 0) return false;
  for (const tag of node.tags) {
    if (boundaryTagNames.includes(tag)) return true;
  }
  return false;
}
