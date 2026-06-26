/**
 * Anomaly engine (T12).
 *
 * Per docs/01 §FR5 and docs/08 T12 acceptance:
 *   - emits anomaly signals for nodes whose outbound or inbound edge
 *     count is in the top `percentile_threshold` of the graph
 *   - respects `allowed_edge_kinds` from the engine config
 *   - reports the actual count and the threshold used
 *
 * Implementation: per-edge-kind filter, count fan-out and fan-in
 * across all file nodes, take the value at the
 * (1 - percentile_threshold) quantile of the sorted distribution.
 * Any node above that value is anomalous.
 *
 * Determinism: input is the GraphStore (deterministic) and the
 * threshold is a config value. Output sorted by (severity desc, id
 * asc) so two runs on the same input produce identical output.
 *
 * Limitations (per docs/01 §G3):
 *   - single-metric view (fan-out, fan-in). Anomalies are flagged but
 *     the engine cannot tell you WHY the node is unusual.
 *   - false positives on purpose-built hubs (e.g. an `index.ts` barrel
 *     that intentionally re-exports everything).
 *   - severity scale is heuristic; not calibrated against historical
 *     defect rates.
 */

import { isEdgeKindAllowed, makeSignalId, type Signal } from "../radial/signals.js";
import type { EdgeKind, GraphStore } from "../../graph/index.js";

/**
 * Per-engine config. Adds `percentile_threshold` (default 0.99 = top
 * 1%) plus the standard `enabled` flag.
 */
export interface AnomalyEngineConfig {
  enabled: boolean;
  /**
   * Fraction in [0, 1]. Nodes whose metric is in the top
   * (1 - percentile_threshold) of the distribution are flagged.
   * 0.99 means flag the top 1% of nodes. 0.95 = top 5%. Default 0.99.
   */
  percentile_threshold?: number;
  allowed_edge_kinds?: readonly EdgeKind[];
}

const DEFAULT_PERCENTILE_THRESHOLD = 0.99;

/**
 * Compute the threshold value at the given percentile of `counts`.
 * Returns the value of the highest `Math.floor(N * (1 - p))` items,
 * i.e. the (1-p)th quantile. For p=0.99 and 100 items, the 99th
 * percentile of the sorted array.
 *
 * Uses inclusive lower bound: `quantile * N` clamped to [0, N-1].
 *
 * Edge cases:
 *   - empty array: returns 0 (no threshold defined; engine emits nothing)
 *   - 1 item: returns that one value
 *   - p = 0: returns the max (every node with > 0 count is anomalous)
 *   - p = 1: returns 0 (nothing is anomalous)
 */
function computeThreshold(counts: number[], percentile: number): number {
  if (counts.length === 0) return 0;
  if (counts.length === 1) return counts[0];
  if (percentile <= 0) return Math.max(...counts);
  if (percentile >= 1) return 0;
  // Sort ascending.
  const sorted = [...counts].sort((a, b) => a - b);
  // Index of the (1 - percentile)th item from the right.
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(sorted.length * (1 - percentile))),
  );
  return sorted[idx];
}

/**
 * Severity for a metric-vs-threshold ratio. Heuristic scale:
 *   - ratio 1.0–1.5x: info
 *   - 1.5–3x:    low
 *   - 3–6x:      medium
 *   - 6–12x:     high
 *   - > 12x:     critical
 */
function anomalySeverity(ratio: number): Signal["severityHint"] {
  if (ratio <= 1.5) return "info";
  if (ratio <= 3) return "low";
  if (ratio <= 6) return "medium";
  if (ratio <= 12) return "high";
  return "critical";
}

/**
 * Run the anomaly engine. Emits one signal per file node whose
 * outbound or inbound edge count (filtered by `allowed_edge_kinds`)
 * exceeds the configured threshold. Self-loops count as both
 * inbound and outbound.
 *
 * Singleton graph (no edges) returns empty.
 */
export function runAnomalyEngine(
  store: GraphStore,
  config: AnomalyEngineConfig,
  options: { allowedEdgeKinds?: readonly EdgeKind[] } = {},
): Signal[] {
  if (config.enabled === false) return [];

  const allowedEdgeKinds = options.allowedEdgeKinds ?? config.allowed_edge_kinds;
  const percentile = config.percentile_threshold ?? DEFAULT_PERCENTILE_THRESHOLD;

  // Compute fan-out and fan-in counts for every file node, filtered
  // by allowedEdgeKinds.
  type Counts = { out: number; in: number };
  const counts = new Map<string, Counts>();
  const outCounts: number[] = [];
  const inCounts: number[] = [];

  for (const node of store.allNodes()) {
    if (node.kind !== "file") continue;
    let out = 0;
    for (const edgeId of store.outboundEdges(node.id)) {
      const edge = store.getEdge(edgeId);
      if (!edge) continue;
      if (isEdgeKindAllowed(edge.kind, allowedEdgeKinds)) out++;
    }
    let inN = 0;
    for (const edgeId of store.inboundEdges(node.id)) {
      const edge = store.getEdge(edgeId);
      if (!edge) continue;
      if (isEdgeKindAllowed(edge.kind, allowedEdgeKinds)) inN++;
    }
    counts.set(node.id, { out, in: inN });
    outCounts.push(out);
    inCounts.push(inN);
  }

  if (counts.size === 0) return [];

  // Compute thresholds.
  const outThreshold = computeThreshold(outCounts, percentile);
  const inThreshold = computeThreshold(inCounts, percentile);

  // Identify anomalies.
  const signals: Signal[] = [];
  for (const [nodeId, c] of counts) {
    const node = store.getNode(nodeId);
    if (!node) continue;

    if (c.out > outThreshold) {
      const ratio = c.out / outThreshold;
      signals.push(buildAnomalySignal({
        store,
        nodeId,
        nodePath: node.path,
        metric: "outbound_edges",
        count: c.out,
        threshold: outThreshold,
        ratio,
        kind: "fan_out_anomaly",
      }));
    }

    if (c.in > inThreshold) {
      const ratio = c.in / inThreshold;
      signals.push(buildAnomalySignal({
        store,
        nodeId,
        nodePath: node.path,
        metric: "inbound_edges",
        count: c.in,
        threshold: inThreshold,
        ratio,
        kind: "fan_in_anomaly",
      }));
    }
  }

  return signals;
}

interface AnomalyInput {
  store: GraphStore;
  nodeId: string;
  nodePath: string | undefined;
  metric: "outbound_edges" | "inbound_edges";
  count: number;
  threshold: number;
  ratio: number;
  kind: "fan_out_anomaly" | "fan_in_anomaly";
}

function buildAnomalySignal(input: AnomalyInput): Signal {
  return {
    id: makeSignalId({
      geometryId: "anomaly",
      type: input.kind,
      targetId: input.nodeId,
      // metrics must be Record<string, number>. ratio/threshold/count
      // are numeric; node id goes in metadata.
      metrics: {
        count: input.count,
        threshold: input.threshold,
        ratioTimesHundred: Math.round(input.ratio * 100),
      },
    }),
    geometryId: "anomaly",
    type: input.kind,
    targetKind: "node",
    targetId: input.nodeId,
    anchors: [
      {
        path: input.nodePath ?? "<unknown>",
        range: input.store.getNode(input.nodeId)?.range,
        symbol: input.store.getNode(input.nodeId)?.symbol,
        source: "source",
      },
    ],
    severityHint: anomalySeverity(input.ratio),
    confidenceHint: "medium",
    metrics: {
      count: input.count,
      threshold: input.threshold,
      ratioTimesHundred: Math.round(input.ratio * 100),
    },
    metadata: {
      metric: input.metric,
      observedCount: input.count,
      thresholdCount: input.threshold,
      ratio: Math.round(input.ratio * 100) / 100,
    },
    limitations: [
      "single-metric view: anomalies are flagged but the engine cannot tell you WHY the node is unusual",
      "false positives expected on purpose-built hubs (barrel files, index.ts)",
      "severity scale is heuristic; not calibrated against historical defect rates",
      "static analysis only — runtime metrics (call frequency, response time) are not measured",
    ],
  };
}
