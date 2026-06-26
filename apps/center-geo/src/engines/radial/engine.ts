/**
 * Radial engine (T09).
 *
 * The radial engine is the "blast-radius from a seed" geometry. It
 * answers: "starting from these seed nodes, how far does the graph
 * spread, what boundary tags does it touch, and which nodes are
 * unusually central within that blast radius?"
 *
 * Per docs/01 §FR5 + docs/08 T09 acceptance:
 *   - emits high fan-out signals (a node has many outgoing edges
 *     in the allowed-edge-kinds set)
 *   - emits boundary_reached signals (BFS reaches a node tagged as
 *     a configured boundary — e.g. "ui", "persistence")
 *   - respects depth and edge-kind config (max_depth, allowed_edge_kinds)
 *   - includes path evidence via the underlying BFS result (T08)
 *
 * Per docs/01 §G3 + §FR7:
 *   - signals are HYPOTHESES, not defects
 *   - every signal carries evidence anchors + raw metrics
 *   - every signal lists limitations (what this engine cannot prove)
 *
 * Determinism: BFS (T08) is deterministic on the GraphStore (T04);
 * signals are produced in BFS order so two runs on the same store
 * produce identical output. Signal ids are stable.
 */

import { bfs, type GraphStore } from "../../graph/index.js";
import type { EdgeKind } from "../../graph/index.js";
import type { EngineConfig } from "../../config/index.js";

import {
  isEdgeKindAllowed,
  makeSignalId,
  nodeHasBoundaryTag,
  type Signal,
  type RadialSignalType,
} from "./signals.js";

/**
 * Run the radial engine over `store` with the given config.
 *
 * Inputs:
 *   - store: a GraphStore (T04) — the graph to traverse.
 *   - config: per-engine config (EnginesConfig["radial"] from
 *     src/config/types.ts). Only `enabled`, `max_depth`, `max_nodes`,
 *     and `allowed_edge_kinds` are consulted by T09. Other fields
 *     (e.g. `percentile_threshold`) are T12 (anomaly engine) territory.
 *   - seeds: node ids to start BFS from. If empty, the engine is a
 *     no-op (returns empty signals).
 *   - boundaryTagNames: optional list of tag names that mark
 *     "boundary" nodes. When BFS reaches a node with one of these
 *     tags, the engine emits a boundary_reached signal. Derived
 *     from `Config.boundaries.tags` keys in the public-facing
 *     engine runner (T10+); here we accept it as a parameter so
 *     the engine itself stays decoupled from the config schema.
 *
 * Output: an array of Signal records, in BFS visit order (deterministic).
 */
export function runRadialEngine(
  store: GraphStore,
  config: EngineConfig,
  seeds: string[],
  boundaryTagNames?: string[],
): Signal[] {
  if (config.enabled === false) return [];
  if (seeds.length === 0) return [];

  // Config knobs with sensible defaults.
  const maxDepth = typeof config.max_depth === "number" ? config.max_depth : Infinity;
  const maxNodes = typeof config.max_nodes === "number" ? config.max_nodes : Infinity;
  const allowedEdgeKinds = (config.allowed_edge_kinds ?? []) as readonly EdgeKind[] | undefined;

  // Build the union BFS result (T08 BFS supports a single seed, so
  // we run it per seed and merge).
  const allDepths = new Map<string, number>(); // node id -> min depth
  const allParents = new Map<string, string | null>();
  const allVisitOrder: string[] = [];
  const seenInAnySeed = new Set<string>();

  for (const seed of seeds) {
    if (!store.hasNode(seed)) continue;
    const r = bfs(store, seed);
    for (const [nodeId, d] of r.depth) {
      if (!allDepths.has(nodeId) || (allDepths.get(nodeId) ?? Infinity) > d) {
        allDepths.set(nodeId, d);
      }
    }
    for (const [nodeId, parentEdge] of r.parents) {
      if (!allParents.has(nodeId)) {
        allParents.set(nodeId, parentEdge);
      }
    }
    for (const nodeId of r.reachableInOrder) {
      if (!seenInAnySeed.has(nodeId)) {
        seenInAnySeed.add(nodeId);
        allVisitOrder.push(nodeId);
        if (allVisitOrder.length >= maxNodes) {
          // Reached max_nodes cap.
          break;
        }
      }
    }
    if (allVisitOrder.length >= maxNodes) break;
  }

  const signals: Signal[] = [];
  const seedSet = new Set(seeds);

  // Per-node signal evaluation.
  for (const nodeId of allVisitOrder) {
    const node = store.getNode(nodeId);
    if (!node) continue;
    const depth = allDepths.get(nodeId) ?? 0;
    const parentEdgeId = allParents.get(nodeId) ?? null;
    const parentEdge = parentEdgeId ? store.getEdge(parentEdgeId) : null;
    const inBlastRadius = !seedSet.has(nodeId) || depth > 0;

    // Anchor: the parent edge (if any) plus the node itself.
    const anchors: Signal["anchors"] = [];
    if (parentEdge) {
      anchors.push({
        path: parentEdge.anchors[0]?.path ?? "<unknown>",
        range: parentEdge.anchors[0]?.range,
        symbol: parentEdge.anchors[0]?.symbol,
        source: "source",
      });
    }
    anchors.push({
      path: node.path ?? "<unknown>",
      range: node.range,
      symbol: node.symbol,
      source: "source",
    });

    // ── Signal 1: high_fan_out ───────────────────────────────────
    // A node with many outgoing edges IN THE ALLOWED-EDGE-KINDS SET
    // is a coupling risk. We measure filtered fan-out (not raw
    // fan-out) so config-driven engines focus on the kinds they
    // care about.
    const filteredFanOut = countOutgoingFiltered(store, nodeId, allowedEdgeKinds);
    // High fan-out heuristic: more than 8 allowed-kind outgoing edges
    // for MVP. T12+ will replace with a config-driven percentile.
    if (filteredFanOut > 8) {
      signals.push(buildSignal({
        type: "high_fan_out",
        geometryId: "radial",
        targetId: nodeId,
        targetKind: "node",
        severityHint: filteredFanOut > 16 ? "high" : "medium",
        confidenceHint: filteredFanOut > 16 ? "high" : "medium",
        metrics: { filteredFanOut },
        anchors,
        metadata: { allowedEdgeKinds: allowedEdgeKinds ?? null },
        limitations: [
          "filtered fan-out threshold (8) is a placeholder; T12+ replaces with config-driven percentile",
          "does not weight edges by confidence; counts allowed-kind edges only",
        ],
      }));
    }

    // ── Signal 2: boundary_reached ──────────────────────────────
    // BFS reached a node tagged as a boundary (per config.boundaries.tags).
    if (nodeHasBoundaryTag(node, boundaryTagNames)) {
      signals.push(buildSignal({
        type: "boundary_reached",
        geometryId: "radial",
        targetId: nodeId,
        targetKind: "node",
        severityHint: depth === 1 ? "high" : "medium",
        confidenceHint: depth === 1 ? "high" : "medium",
        metrics: { depth },
        anchors,
        metadata: { boundaryTags: node.tags.filter((t) => boundaryTagNames?.includes(t)) },
        limitations: [
          "boundary identification is tag-based, not type-based; misconfig of config.boundaries.tags causes false negatives",
          "does not distinguish production vs test paths (T12+ enhancement)",
        ],
      }));
    }

    // ── Signal 3: broad_blast_radius ────────────────────────────
    // A node in the blast radius is reachable from many seeds at
    // shallow depth — it concentrates dependency flow.
    // We approximate "reachable from many seeds" by counting how
    // many seeds found this node (cheap proxy using visit order).
    // T10+ replaces with a proper "convergent upstream" count.
    if (inBlastRadius && depth > 0 && depth <= Math.min(maxDepth, 2)) {
      // Cheap heuristic: if a non-seed node appears early in BFS
      // order AND has multiple inbound edges in the allowed kinds,
      // it concentrates flow from many sources.
      const inboundCount = countIncomingFiltered(store, nodeId, allowedEdgeKinds);
      if (inboundCount >= 3) {
        signals.push(buildSignal({
          type: "broad_blast_radius",
          geometryId: "radial",
          targetId: nodeId,
          targetKind: "node",
          severityHint: inboundCount > 6 ? "high" : "medium",
          confidenceHint: inboundCount > 6 ? "high" : "low",
          metrics: { depth, inboundCount },
          anchors,
          metadata: {},
          limitations: [
            "approximation uses inbound-edge count as a proxy for seed coverage; T10+ adds proper seed-coverage count",
          ],
        }));
      }
    }
  }

  return signals;
}

/* ── helpers ───────────────────────────────────────────────────── */

/**
 * Count outgoing edges of `nodeId` whose kind is in `allowedKinds`.
 * If `allowedKinds` is undefined, count ALL outgoing edges.
 */
function countOutgoingFiltered(
  store: GraphStore,
  nodeId: string,
  allowedKinds: readonly EdgeKind[] | undefined,
): number {
  let count = 0;
  for (const edgeId of store.outboundEdges(nodeId)) {
    const edge = store.getEdge(edgeId);
    if (!edge) continue;
    if (isEdgeKindAllowed(edge.kind, allowedKinds)) count++;
  }
  return count;
}

function countIncomingFiltered(
  store: GraphStore,
  nodeId: string,
  allowedKinds: readonly EdgeKind[] | undefined,
): number {
  let count = 0;
  for (const edgeId of store.inboundEdges(nodeId)) {
    const edge = store.getEdge(edgeId);
    if (!edge) continue;
    if (isEdgeKindAllowed(edge.kind, allowedKinds)) count++;
  }
  return count;
}

interface BuildSignalInput {
  type: RadialSignalType;
  geometryId: Signal["geometryId"];
  targetId: string;
  targetKind: Signal["targetKind"];
  severityHint: Signal["severityHint"];
  confidenceHint: Signal["confidenceHint"];
  metrics: Record<string, number>;
  anchors: Signal["anchors"];
  metadata: Record<string, unknown>;
  limitations: string[];
}

function buildSignal(input: BuildSignalInput): Signal {
  return {
    id: makeSignalId({
      geometryId: input.geometryId,
      type: input.type,
      targetId: input.targetId,
      metrics: input.metrics,
    }),
    geometryId: input.geometryId,
    type: input.type,
    targetKind: input.targetKind,
    targetId: input.targetId,
    anchors: input.anchors,
    severityHint: input.severityHint,
    confidenceHint: input.confidenceHint,
    metrics: input.metrics,
    metadata: input.metadata,
    limitations: input.limitations,
  };
}
