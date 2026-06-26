/**
 * GraphStore — immutable read-side accessor over a GraphSnapshot.
 *
 * Built deterministically from a GraphSnapshot:
 *   - Nodes sorted by id (lexicographic).
 *   - Edges sorted by (from, kind, to, id) for stable traversal.
 *   - Indexes built once at construction time (O(N+E) memory).
 *
 * All accessor methods are PURE — they never mutate the snapshot or
 * the indexes. Constructing a new store with different content
 * produces a new instance with fresh indexes; the original is
 * unchanged. This immutability guarantee is what makes T08 algorithms
 * safe to call multiple times on the same store during fusion.
 *
 * The store is the read-side of the graph pipeline:
 *   - T05-T07 build a GraphSnapshot.
 *   - T08 algorithms read via GraphStore.
 *   - T09 radial engine emits signals from GraphStore.
 */

import type { EdgeKind, GraphEdge, GraphNode, GraphSnapshot, NodeKind } from "./types.js";

/* ── key types for lookups ──────────────────────────────────────── */

/**
 * Stable ordering key for an edge. Used internally for sorting and as
 * the Map key when grouping edges by (from, kind). Including all four
 * fields guarantees a unique ordering even when the same from→to
 * carries multiple edges of different kinds.
 */
export type EdgeOrderKey = `${string}\u0000${EdgeKind}\u0000${string}\u0000${string}`;

function edgeOrderKey(e: GraphEdge): EdgeOrderKey {
  // NUL separator avoids any string collision (paths/kinds can't
  // contain NUL in practice).
  return `${e.from}\u0000${e.kind}\u0000${e.to}\u0000${e.id}` as EdgeOrderKey;
}

/* ── store ──────────────────────────────────────────────────────── */

export class GraphStore {
  /** The snapshot this store wraps. Never mutated after construction. */
  readonly snapshot: GraphSnapshot;

  // ── internal indexes (built once at construction) ──────────────

  /** id → node. */
  private readonly nodesById: ReadonlyMap<string, GraphNode>;
  /** id → edge. */
  private readonly edgesById: ReadonlyMap<string, GraphEdge>;
  /** Node ids by tag. */
  private readonly nodeIdsByTag: ReadonlyMap<string, string[]>;
  /** Edge ids by kind. */
  private readonly edgeIdsByKind: ReadonlyMap<EdgeKind, string[]>;
  /** Outbound edges by node id: from-node-id → edge ids (sorted). */
  private readonly outboundByNode: ReadonlyMap<string, string[]>;
  /** Inbound edges by node id: to-node-id → edge ids (sorted). */
  private readonly inboundByNode: ReadonlyMap<string, string[]>;

  constructor(snapshot: GraphSnapshot) {
    // Deterministic sort: nodes by id, edges by (from, kind, to, id).
    const sortedNodes = [...snapshot.nodes].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const sortedEdges = [...snapshot.edges].sort((a, b) => {
      const ak = edgeOrderKey(a);
      const bk = edgeOrderKey(b);
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });

    this.snapshot = { ...snapshot, nodes: sortedNodes, edges: sortedEdges };

    // Build indexes.
    const nodesById = new Map<string, GraphNode>();
    const nodeIdsByTag = new Map<string, string[]>();
    for (const n of sortedNodes) {
      nodesById.set(n.id, n);
      for (const tag of n.tags) {
        const list = nodeIdsByTag.get(tag);
        if (list) list.push(n.id);
        else nodeIdsByTag.set(tag, [n.id]);
      }
    }
    this.nodesById = nodesById;
    this.nodeIdsByTag = nodeIdsByTag;

    const edgesById = new Map<string, GraphEdge>();
    const edgeIdsByKind = new Map<EdgeKind, string[]>();
    const outboundByNode = new Map<string, string[]>();
    const inboundByNode = new Map<string, string[]>();
    for (const e of sortedEdges) {
      edgesById.set(e.id, e);
      // By kind
      const byKind = edgeIdsByKind.get(e.kind);
      if (byKind) byKind.push(e.id);
      else edgeIdsByKind.set(e.kind, [e.id]);
      // Outbound from `e.from`
      const outList = outboundByNode.get(e.from);
      if (outList) outList.push(e.id);
      else outboundByNode.set(e.from, [e.id]);
      // Inbound to `e.to`
      const inList = inboundByNode.get(e.to);
      if (inList) inList.push(e.id);
      else inboundByNode.set(e.to, [e.id]);
    }
    this.edgesById = edgesById;
    this.edgeIdsByKind = edgeIdsByKind;
    this.outboundByNode = outboundByNode;
    this.inboundByNode = inboundByNode;
  }

  /* ── size helpers ────────────────────────────────────────────── */

  /** Number of nodes. O(1). */
  get nodeCount(): number {
    return this.nodesById.size;
  }

  /** Number of edges. O(1). */
  get edgeCount(): number {
    return this.edgesById.size;
  }

  /* ── single-element lookups ───────────────────────────────────── */

  /** Get a node by id. O(1). Returns undefined if not present. */
  getNode(id: string): GraphNode | undefined {
    return this.nodesById.get(id);
  }

  /** Get an edge by id. O(1). Returns undefined if not present. */
  getEdge(id: string): GraphEdge | undefined {
    return this.edgesById.get(id);
  }

  /** True iff the node id is present in this store. O(1). */
  hasNode(id: string): boolean {
    return this.nodesById.has(id);
  }

  /** True iff the edge id is present in this store. O(1). */
  hasEdge(id: string): boolean {
    return this.edgesById.has(id);
  }

  /* ── grouped lookups ──────────────────────────────────────────── */

  /** Ids of all nodes carrying a given tag. O(K) where K = nodes with tag. */
  nodesByTag(tag: string): string[] {
    return this.nodeIdsByTag.get(tag) ?? [];
  }

  /** Ids of all edges of a given kind. O(K). */
  edgesByKind(kind: EdgeKind): string[] {
    return this.edgeIdsByKind.get(kind) ?? [];
  }

  /** Edge ids leaving `nodeId`, sorted. Returns [] if node has no outbound edges. */
  outboundEdges(nodeId: string): string[] {
    return this.outboundByNode.get(nodeId) ?? [];
  }

  /** Edge ids entering `nodeId`, sorted. Returns [] if node has no inbound edges. */
  inboundEdges(nodeId: string): string[] {
    return this.inboundByNode.get(nodeId) ?? [];
  }

  /* ── convenience resolvers ────────────────────────────────────── */

  /** All nodes (deterministic order). Returns a fresh array — caller may mutate. */
  allNodes(): GraphNode[] {
    return [...this.snapshot.nodes];
  }

  /** All edges (deterministic order). Returns a fresh array — caller may mutate. */
  allEdges(): GraphEdge[] {
    return [...this.snapshot.edges];
  }

  /** Outbound edges from `nodeId`, resolved to full GraphEdge objects. */
  outboundEdgesResolved(nodeId: string): GraphEdge[] {
    const ids = this.outboundEdges(nodeId);
    const out: GraphEdge[] = [];
    for (const id of ids) {
      const e = this.edgesById.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  /** Inbound edges to `nodeId`, resolved to full GraphEdge objects. */
  inboundEdgesResolved(nodeId: string): GraphEdge[] {
    const ids = this.inboundEdges(nodeId);
    const out: GraphEdge[] = [];
    for (const id of ids) {
      const e = this.edgesById.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  /* ── summary ──────────────────────────────────────────────────── */

  /**
   * Build a human-readable summary of the store. Used for `--summary`
   * CLI flag (T09+) and for debug output. Includes counts by kind and
   * the top-10 most-fan-in / fan-out nodes.
   */
  summary(): GraphSummary {
    const nodesByKind = new Map<NodeKind, number>();
    for (const n of this.snapshot.nodes) {
      nodesByKind.set(n.kind, (nodesByKind.get(n.kind) ?? 0) + 1);
    }
    const edgesByKindMap = new Map<EdgeKind, number>();
    for (const e of this.snapshot.edges) {
      edgesByKindMap.set(e.kind, (edgesByKindMap.get(e.kind) ?? 0) + 1);
    }
    const fanIn = new Map<string, number>();
    for (const ids of this.inboundByNode.values()) {
      for (const eid of ids) {
        const e = this.edgesById.get(eid);
        if (!e) continue;
        fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
      }
    }
    const fanOut = new Map<string, number>();
    for (const ids of this.outboundByNode.values()) {
      for (const eid of ids) {
        const e = this.edgesById.get(eid);
        if (!e) continue;
        fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
      }
    }
    const topFanIn = [...fanIn.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));
    const topFanOut = [...fanOut.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));
    return {
      nodes: this.nodeCount,
      edges: this.edgeCount,
      nodesByKind: Object.fromEntries(nodesByKind),
      edgesByKind: Object.fromEntries(edgesByKindMap),
      topFanIn,
      topFanOut,
    };
  }
}

export interface GraphSummary {
  nodes: number;
  edges: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  topFanIn: { id: string; count: number }[];
  topFanOut: { id: string; count: number }[];
}
