/**
 * Cycle engine — detects import cycles and self-loops in the graph.
 *
 * Per docs/01 §FR5 and docs/08 T10 acceptance:
 *   - emits a `cycle_detected` signal for every SCC with `isCycle: true`
 *     (multi-node cycle OR single-node self-loop)
 *   - respects `enabled` and `max_cycle_size` config
 *   - includes path evidence via the first internal edge of the cycle
 *   - severity scales with SCC size (2 = low, 3-4 = medium, 5+ = high)
 *
 * Implementation: T08's `stronglyConnectedComponents` is the workhorse.
 * This engine wraps it and converts each `isCycle` SCC into a Signal.
 *
 * Determinism: SCC output is sorted by (size desc, first-member id),
 * T08 guarantee. Signal ids are stable: `s:cycle:cycle_detected:<scc-id>:<hash>`.
 */

import { stronglyConnectedComponents, type GraphStore } from "../../graph/index.js";
import { makeSignalId } from "../radial/signals.js";
import type { Signal } from "../radial/signals.js";

/**
 * Cycle-engine-specific config. Extends the common EngineConfig
 * shell with a `max_cycle_size` knob. Note: this engine does NOT use
 * `max_depth`, `max_nodes`, or `allowed_edge_kinds` — cycles don't
 * have depth, and ALL edge kinds are inspected (a cycle can be made
 * of imports OR calls).
 */
export interface CycleEngineConfig {
  enabled: boolean;
  /**
   * Maximum cycle size to report. Cycles larger than this are
   * skipped (not reported). Useful for excluding architectural
   * patterns that are unfixable (e.g. a deliberate "let me import
   * myself for self-reference" idiom). Undefined = no limit.
   */
  max_cycle_size?: number;
}

/**
 * Severity for a cycle. Scales with the SCC size because bigger cycles
 * are typically harder to fix (more files to change, more risk).
 */
function severityForCycleSize(size: number): Signal["severityHint"] {
  if (size <= 2) return "low";
  if (size <= 4) return "medium";
  if (size <= 8) return "high";
  return "critical";
}

/**
 * Run the cycle engine on `store`. Emits one Signal per cyclic SCC.
 * Singletons (size 1, isCycle false) are skipped — only real cycles
 * (multi-node OR self-loop) are reported.
 */
export function runCycleEngine(
  store: GraphStore,
  config: CycleEngineConfig,
): Signal[] {
  if (config.enabled === false) return [];

  const sccs = stronglyConnectedComponents(store);
  const signals: Signal[] = [];

  for (const scc of sccs) {
    if (!scc.isCycle) continue;
    if (
      typeof config.max_cycle_size === "number" &&
      scc.members.length > config.max_cycle_size
    ) {
      continue;
    }

    // Pick the first internal edge of the cycle as the primary
    // anchor. internalEdges is sorted (T08 guarantee), so this is
    // deterministic across runs. isCycle SCCs always have at least
    // 1 member and at least 1 internal edge (T08 invariant), so the
    // `scc.members[0]` and `scc.edges[0]` lookups are guaranteed
    // non-empty (the `?` is a defensive no-op; the runtime never
    // produces an isCycle SCC with no members/edges).
    const firstEdge = store.getEdge(scc.edges[0]);
    const firstNode = store.getNode(scc.members[0]);
    const anchors: Signal["anchors"] = [];
    if (firstEdge) {
      const firstAnchor = firstEdge.anchors[0];
      anchors.push({
        path: firstAnchor?.path ?? firstNode?.path ?? "<unknown>",
        range: firstAnchor?.range,
        symbol: firstAnchor?.symbol ?? firstEdge.from,
        source: "source",
      });
    }
    if (firstNode) {
      anchors.push({
        path: firstNode.path ?? "<unknown>",
        range: firstNode.range,
        symbol: firstNode.symbol,
        source: "source",
      });
    }

    // Add an anchor for every other member so users can see the full
    // cycle in the report. The primary anchor above is the first one;
    // these are secondary.
    for (let i = 1; i < scc.members.length; i++) {
      const m = store.getNode(scc.members[i]);
      if (m) {
        anchors.push({
          path: m.path ?? "<unknown>",
          range: m.range,
          symbol: m.symbol,
          source: "source",
        });
      }
    }

    signals.push({
      id: makeSignalId({
        geometryId: "cycle",
        type: "cycle_detected",
        targetId: scc.id,
        metrics: { cycleSize: scc.members.length, internalEdges: scc.edges.length },
      }),
      geometryId: "cycle",
      type: "cycle_detected",
      targetKind: "subgraph",
      targetId: scc.id,
      anchors,
      severityHint: severityForCycleSize(scc.members.length),
      confidenceHint: "high",
      metrics: {
        cycleSize: scc.members.length,
        internalEdges: scc.edges.length,
      },
      metadata: {
        members: scc.members,
        internalEdgeIds: scc.edges,
      },
      limitations: [
        "static cycle only — runtime cycles via dynamic require() are not detected",
        "TypeScript type-level cycles (type-only imports) are not detected by the parser",
        "cyclic cost in the engine is O(V+E) per scan (T08's iterative Tarjan); deep dependency cycles in large repos take longer to report",
      ],
    });
  }

  return signals;
}
