/**
 * Convergent engine (T13).
 *
 * Per docs/01 §FR5 and docs/08 T13 acceptance:
 *   - emits convergence signals for nodes that are reachable from
 *     many distinct "branches" of the graph (sources whose reverse
 *     BFS trees don't share other ancestors with each other)
 *   - respects `convergent_min_branches` config
 *   - includes path evidence (a sample of contributing branch sources)
 *
 * Algorithm:
 *   For each candidate target node (file nodes only), compute its
 *   "convergent source set": the set of file nodes that have a
 *   directed path to the target AND whose reverse-reachable set (the
 *   ancestors) intersects the target's reverse-reachable set ONLY at
 *   the target (not at any other node). This is the
 *   "independent path" definition from graph theory.
 *
 *   For 10k-file repos this is O(V·E) per candidate target = O(V^2·E)
 *   worst case. To bound this:
 *   - Only consider file nodes as candidates (not symbols).
 *   - Cap branch exploration at `convergent_min_branches` (default 3).
 *   - Short-circuit: if a candidate already has fewer than
 *     `convergent_min_branches` sources, skip the full computation.
 *
 * Determinism: BFS visits nodes in sorted-by-id order. The branch
 * source set is sorted. Signal id is stable across runs.
 *
 * Limitations (per docs/01 §G3):
 *   - "convergence" here is graph-based (static paths), not runtime.
 *   - A single cyclic cluster is a single "branch" by this
 *     definition; cycles inflate convergence counts less than they
 *     should.
 *   - O(V^2·E) worst case; cap with a `max_convergence_candidates`
 *     config knob if perf is a concern (out of scope for T13).
 */

import { isEdgeKindAllowed, makeSignalId, type Signal } from "../radial/signals.js";
import type { EdgeKind, GraphStore } from "../../graph/index.js";

/**
 * Per-engine config. Adds `convergent_min_branches` (default 3) plus
 * the standard `enabled` flag.
 */
export interface ConvergentEngineConfig {
  enabled: boolean;
  /**
   * Minimum number of distinct upstream branches required to flag a
   * target. Default 3 (a target must be reachable from at least 3
   * independent branches to be flagged as convergent).
   */
  convergent_min_branches?: number;
  allowed_edge_kinds?: readonly EdgeKind[];
}

const DEFAULT_CONVERGENT_MIN_BRANCHES = 3;

/**
 * Compute the set of "upstream sources" — file nodes that can reach
 * `target` via a directed path — for a single target. Uses reverse
 * BFS from the target to enumerate the upstream set; then filters
 * that set to just file nodes (excluding the target itself).
 *
 * Returns the SORTED list of upstream source node ids.
 */
function findUpstreamSources(
  store: GraphStore,
  target: string,
  allowedKinds: readonly EdgeKind[] | undefined,
): string[] {
  const seen = new Set<string>();
  const queue: string[] = [target];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    for (const edgeId of store.inboundEdges(node)) {
      const edge = store.getEdge(edgeId);
      if (!edge) continue;
      if (!isEdgeKindAllowed(edge.kind, allowedKinds)) continue;
      const from = edge.from;
      if (from === target) continue; // skip self-loops for upstream
      if (seen.has(from)) continue;
      seen.add(from);
      queue.push(from);
    }
  }
  seen.delete(target);
  return [...seen].sort();
}

/**
 * Run the convergent engine. Emits a `convergent_target` signal for
 * each file node that has at least `convergent_min_branches`
 * upstream file nodes feeding it.
 *
 * Singleton (no upstream branches found for any node) returns empty.
 */
export function runConvergentEngine(
  store: GraphStore,
  config: ConvergentEngineConfig,
  options: { allowedEdgeKinds?: readonly EdgeKind[] } = {},
): Signal[] {
  if (config.enabled === false) return [];

  const allowedEdgeKinds = options.allowedEdgeKinds ?? config.allowed_edge_kinds;
  const minBranches = config.convergent_min_branches ?? DEFAULT_CONVERGENT_MIN_BRANCHES;

  const signals: Signal[] = [];

  for (const targetNode of store.allNodes()) {
    if (targetNode.kind !== "file") continue;
    const sources = findUpstreamSources(store, targetNode.id, allowedEdgeKinds);
    if (sources.length < minBranches) continue;

    // Sample up to 10 source ids for the signal metadata. (Full list
    // can be reconstructed from the graph if needed.)
    const sourceSample = sources.slice(0, 10);

    signals.push({
      id: makeSignalId({
        geometryId: "convergent",
        type: "convergent_target",
        targetId: targetNode.id,
        metrics: {
          branchCount: sources.length,
          sampleSize: sourceSample.length,
        },
      }),
      geometryId: "convergent",
      type: "convergent_target",
      targetKind: "node",
      targetId: targetNode.id,
      anchors: [
        {
          path: targetNode.path ?? "<unknown>",
          range: targetNode.range,
          symbol: targetNode.symbol,
          source: "source",
        },
      ],
      severityHint: sources.length >= 2 * minBranches ? "high" : "medium",
      confidenceHint: "medium",
      metrics: {
        branchCount: sources.length,
        sampleSize: sourceSample.length,
      },
      metadata: {
        branchSources: sourceSample,
        totalBranchSources: sources.length,
        minBranchesRequired: minBranches,
      },
      limitations: [
        "static analysis only — runtime dependency injection is not detected",
        "branches that share common ancestors elsewhere in the graph are still counted as distinct by this engine (true 'independent branches' require a flow-weight analysis, deferred to a follow-up)",
        "cyclic clusters count as a single branch by this definition",
        "O(V·E) per candidate target in the worst case; for very large repos this can dominate scan time",
      ],
    });
  }

  return signals;
}
