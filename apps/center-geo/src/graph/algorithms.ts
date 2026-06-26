/**
 * Graph algorithms (T08): BFS, reverse BFS, SCC.
 *
 * All three operate on a GraphStore (T04). Algorithms are pure:
 * same input store + same seed → same output. Determinism is
 * guaranteed by GraphStore's sorted iteration order (nodes/edges
 * are sorted by id at construction time).
 *
 * Algorithms:
 *   - bfs: standard breadth-first search from a seed node, returning
 *     the depth of every reachable node. Used by the radial engine
 *     (T09) to find the seed's blast radius.
 *   - reverseBfs: BFS over incoming edges instead of outgoing. Used by
 *     the convergent engine (T13+) to find upstream shared dependencies.
 *   - stronglyConnectedComponents: Tarjan's algorithm. Returns the SCCs
 *     sorted by member-id, then by component id (deterministic).
 *     Used by the cycle engine (T10) to detect import cycles and
 *     stateful loops.
 *
 * Performance: BFS/reverseBFS are O(V + E). SCC is O(V + E) (one pass).
 * For the 10k-file target (per docs/01 NFR3), these complete in
 * well under 60 seconds.
 */

import type { GraphStore } from "./store.js";
import { sha256Hex16 } from "./ids.js";

/* ── BFS (forward) ─────────────────────────────────────────────── */

/**
 * BFS result for a single seed node.
 *   - depth: a map from reachable node id -> shortest distance from seed.
 *   - parents: a map from reachable node id -> the edge id that
 *     reached it (for path reconstruction).
 *   - reachableInOrder: the order nodes were dequeued (BFS order).
 *     Used by the radial engine to compute "breadth at depth N".
 */
export interface BfsResult {
  /** Seed id (echoed for convenience). */
  seed: string;
  /** Map of reachable node id -> shortest path depth (0 = seed itself). */
  depth: Map<string, number>;
  /** Map of reachable node id -> id of the edge we traversed to reach it. */
  parents: Map<string, string | null>;
  /** BFS visit order (deterministic: sorted-by-id adjacency). */
  reachableInOrder: string[];
}

/**
 * Standard BFS from `seed`. Visits all reachable nodes via outgoing
 * edges (any kind, any confidence). Edges are not weighted — this
 * is unweighted BFS.
 *
 * Multi-edges between the same (from, to) are all traversed, but the
 * `depth` map records the FIRST edge that reached each node (so
 * path reconstruction is unambiguous).
 */
export function bfs(store: GraphStore, seed: string): BfsResult {
  const depth = new Map<string, number>();
  const parents = new Map<string, string | null>();
  const reachableInOrder: string[] = [];

  if (!store.hasNode(seed)) {
    return { seed, depth, parents, reachableInOrder };
  }

  depth.set(seed, 0);
  parents.set(seed, null);
  reachableInOrder.push(seed);

  // Simple queue. Push at end, shift from front. For 10k nodes, this
  // is fine; for 1M+ nodes we'd want an index-based ring buffer.
  const queue: string[] = [seed];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDepth = depth.get(current) ?? 0;
    // outgoingEdges returns edge ids in sorted order (T04 guarantee).
    for (const edgeId of store.outboundEdges(current)) {
      const edge = store.getEdge(edgeId);
      if (!edge) continue;
      // Already visited (depth is set the first time we reach a node).
      if (depth.has(edge.to)) continue;
      depth.set(edge.to, currentDepth + 1);
      parents.set(edge.to, edge.id);
      reachableInOrder.push(edge.to);
      queue.push(edge.to);
    }
  }

  return { seed, depth, parents, reachableInOrder };
}

/* ── Reverse BFS ──────────────────────────────────────────────── */

/**
 * BFS over incoming edges. Returns the same shape as `bfs`, but the
 * traversal is "upstream" — for any reachable node N, the depth is
 * the length of the shortest path from N to `seed` (i.e. how many
 * hops upstream a node is from the seed).
 *
 * Used by the convergent engine (T13+).
 */
export function reverseBfs(store: GraphStore, seed: string): BfsResult {
  const depth = new Map<string, number>();
  const parents = new Map<string, string | null>();
  const reachableInOrder: string[] = [];

  if (!store.hasNode(seed)) {
    return { seed, depth, parents, reachableInOrder };
  }

  depth.set(seed, 0);
  parents.set(seed, null);
  reachableInOrder.push(seed);

  const queue: string[] = [seed];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDepth = depth.get(current) ?? 0;
    for (const edgeId of store.inboundEdges(current)) {
      const edge = store.getEdge(edgeId);
      if (!edge) continue;
      // In reverse BFS, the "from" side is the next node (we walk
      // upstream). We record the edge id for path reconstruction.
      if (depth.has(edge.from)) continue;
      depth.set(edge.from, currentDepth + 1);
      parents.set(edge.from, edge.id);
      reachableInOrder.push(edge.from);
      queue.push(edge.from);
    }
  }

  return { seed, depth, parents, reachableInOrder };
}

/* ── Strongly connected components (Tarjan) ───────────────────── */

/**
 * Tarjan's strongly-connected-components algorithm.
 * Returns the SCCs sorted by:
 *   1. Component size descending (largest SCCs first — these are the
 *      "real" cycles).
 *   2. Within each component, members sorted by id.
 *   3. Ties broken by the first member's id (stable sort).
 *
 * Each SCC entry contains:
 *   - id: a stable id `scc:<deterministic-hash>` for the component.
 *   - members: sorted array of node ids in the component.
 *   - edges: edges WITHIN the component (every member-to-member edge
 *     that lives entirely inside this component).
 *   - isCycle: true if the component has >1 member OR a self-loop.
 */
export interface StronglyConnectedComponent {
  id: string;
  members: string[];
  edges: string[];
  isCycle: boolean;
}

/**
 * Run Tarjan's SCC on the graph. Returns the SCCs in deterministic
 * order (see StronglyConnectedComponent doc above).
 *
 * Implementation notes:
 *   - Classic Tarjan: O(V + E) using a single DFS pass with index,
 *     lowlink, and an on-stack set.
 *   - **Iterative** (not recursive) so a 1M-node SCC doesn't blow
 *     Node's default ~10k-frame V8 stack. Uses an explicit work
 *     stack where each frame tracks (node, iterator position) so the
 *     algorithm is still a single DFS pass with the same O(V+E)
 *     complexity.
 *   - Self-loops are detected: a node with an edge to itself forms an
 *     SCC of size 1 but isCycle=true.
 */
export function stronglyConnectedComponents(
  store: GraphStore,
): StronglyConnectedComponent[] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  /**
   * Frame in the explicit DFS work stack. `node` is the node being
   * visited; `nextChildIdx` is the next index in `outboundEdges(node)`
   * to process (a cursor — advances as we pop frames).
   */
  interface Frame {
    node: string;
    /** Pre-computed list of successor node ids (deterministic). */
    successors: string[];
    /** Cursor into successors. */
    nextChildIdx: number;
  }

  // Iterate over all nodes in sorted order (T04 guarantee). This
  // makes the SCC output fully deterministic regardless of insertion
  // order.
  for (const startNode of store.allNodes().map((n) => n.id)) {
    if (idx.has(startNode)) continue;

    // Start a new DFS from startNode. The work stack holds frames
    // for the "currently active" path from a root; each frame
    // corresponds to one recursion call in the textbook algorithm.
    const workStack: Frame[] = [];
    // Initialize the root frame.
    idx.set(startNode, index);
    low.set(startNode, index);
    index++;
    stack.push(startNode);
    onStack.add(startNode);
    const startSuccs: string[] = [];
    for (const edgeId of store.outboundEdges(startNode)) {
      const e = store.getEdge(edgeId);
      if (e) startSuccs.push(e.to);
    }
    workStack.push({ node: startNode, successors: startSuccs, nextChildIdx: 0 });

    while (workStack.length > 0) {
      const frame = workStack[workStack.length - 1];
      const v = frame.node;
      const w = frame.successors[frame.nextChildIdx];

      if (w === undefined) {
        // All successors visited. Pop this frame and decide whether
        // v is an SCC root.
        workStack.pop();
        if (workStack.length > 0) {
          // CRITICAL: propagate low[v] up to the new top-of-stack
          // (the parent). In the recursive algorithm this is the
          // `low.set(v, Math.min(low.get(v), low.get(w)))` line
          // after `strongconnect(w)` returns. In the iterative form
          // we have to do it at the pop point because we lose the
          // v → parent reference when v is no longer on the work stack.
          const parent = workStack[workStack.length - 1].node;
          low.set(parent, Math.min(low.get(parent) ?? 0, low.get(v) ?? 0));
        }
        if (low.get(v) === idx.get(v)) {
          // v is an SCC root: pop the stack until we pop v.
          const component: string[] = [];
          let popped: string | undefined;
          do {
            popped = stack.pop();
            if (popped === undefined) break;
            onStack.delete(popped);
            component.push(popped);
          } while (popped !== v);
          component.sort();
          sccs.push(component);
        }
        continue;
      }

      // Advance the cursor BEFORE processing the child, so the
      // next iteration of this loop moves to the next successor.
      frame.nextChildIdx++;

      if (!idx.has(w)) {
        // Tree edge: descend into w. Push a new frame for w.
        idx.set(w, index);
        low.set(w, index);
        index++;
        stack.push(w);
        onStack.add(w);
        const wSuccs: string[] = [];
        for (const edgeId of store.outboundEdges(w)) {
          const e = store.getEdge(edgeId);
          if (e) wSuccs.push(e.to);
        }
        workStack.push({ node: w, successors: wSuccs, nextChildIdx: 0 });
        continue;
      }

      if (onStack.has(w)) {
        // Back/cross edge to an ancestor on the current path.
        low.set(v, Math.min(low.get(v) ?? 0, idx.get(w) ?? 0));
      }
      // If w is already indexed but not on the current stack, it's
      // a cross edge to a different SCC — no lowlink update.
    }
  }

  // Build the SCC result objects.
  return sccs
    .map((members): StronglyConnectedComponent | null => {
      if (members.length === 0) return null;
      const memberSet = new Set(members);
      // Edges entirely within this component.
      const internalEdges: string[] = [];
      let hasSelfLoop = false;
      for (const m of members) {
        for (const edgeId of store.outboundEdges(m)) {
          const edge = store.getEdge(edgeId);
          if (!edge) continue;
          if (memberSet.has(edge.to)) {
            internalEdges.push(edgeId);
            if (edge.to === m) hasSelfLoop = true;
          }
        }
      }
      internalEdges.sort();
      // Deterministic id: SHA-256 of the sorted member list, truncated
      // to 16 hex chars via the shared sha256Hex16 helper.
      const idHash = sha256Hex16(members.join("\n"));
      return {
        id: `scc:${idHash}`,
        members,
        edges: internalEdges,
        isCycle: members.length > 1 || hasSelfLoop,
      };
    })
    .filter((scc): scc is StronglyConnectedComponent => scc !== null)
    // Sort by size desc, then by first member's id, for deterministic
    // output regardless of the order Tarjan's recursion produced.
    .sort((a, b) => {
      if (a.members.length !== b.members.length) {
        return b.members.length - a.members.length;
      }
      const aFirst = a.members[0] ?? "";
      const bFirst = b.members[0] ?? "";
      return aFirst < bFirst ? -1 : aFirst > bFirst ? 1 : 0;
    });
}
