/**
 * Graph module — public surface.
 *
 * T05+ (TypeScript adapter) will produce GraphNode/GraphEdge from
 * real parser output. T08 (algorithms) consumes them. T09 (radial
 * engine) emits signals from them. The graph module is the single
 * source of truth for the shape that flows through the rest of the
 * pipeline.
 */

export type {
  Anchor,
  AnchorSource,
  Confidence,
  CoverageStats,
  EdgeKind,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  GraphWarning,
  NodeKind,
  SourceRange,
} from "./types.js";

export {
  makeNodeId,
  makeEdgeId,
  fileNodeId,
  normalizeId,
  type EdgeIdInput,
  type AnchorSignature,
} from "./ids.js";

export { GraphStore, type GraphSummary, type EdgeOrderKey } from "./store.js";
