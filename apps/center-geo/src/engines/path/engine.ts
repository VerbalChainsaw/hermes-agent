/**
 * Path engine (T25).
 *
 * Bounded DFS from configured entry tags to sink tags.
 * Lazy version: reuse the existing GraphStore, edge taxonomy, and glob
 * matcher. No fake runtime certainty, no whole-program execution model.
 */

import { matchesAny } from "../../enumerate/glob.js";
import { sha256Hex16 } from "../../graph/ids.js";
import type { EdgeKind, GraphNode, GraphStore } from "../../graph/index.js";
import { isEdgeKindAllowed, makeSignalId, type Signal } from "../radial/signals.js";

export interface PathEngineConfig {
  enabled: boolean;
  max_depth?: number;
  allowed_edge_kinds?: readonly EdgeKind[];
  entry_tags?: string[];
  sink_tags?: string[];
  guard_tags?: string[];
  path_count_cap?: number;
  long_path_min_length?: number;
}

export interface PathEngineOptions {
  tagGlobs?: Record<string, string[]>;
  tagSelectors?: Record<string, { globs?: string[]; symbols?: string[] }>;
  allowedEdgeKinds?: readonly EdgeKind[];
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_PATH_COUNT_CAP = 25;
const DEFAULT_LONG_PATH_MIN_LENGTH = 4;

export function runPathEngine(
  store: GraphStore,
  config: PathEngineConfig,
  options: PathEngineOptions = {},
): Signal[] {
  if (config.enabled === false) return [];

  const tagSelectors = options.tagSelectors ?? selectorsFromGlobs(options.tagGlobs ?? {});
  const entryTags = config.entry_tags ?? [];
  const sinkTags = config.sink_tags ?? [];
  if (entryTags.length === 0 || sinkTags.length === 0) return [];

  const maxDepth = config.max_depth ?? DEFAULT_MAX_DEPTH;
  const pathCountCap = config.path_count_cap ?? DEFAULT_PATH_COUNT_CAP;
  const longPathMinLength = config.long_path_min_length ?? DEFAULT_LONG_PATH_MIN_LENGTH;
  const guardTags = config.guard_tags ?? [];
  const allowedEdgeKinds = options.allowedEdgeKinds ?? config.allowed_edge_kinds;
  const hasAnyTestCoverage = store.allEdges().some((edge) => edge.kind === "test_of");

  const entries = store
    .allNodes()
    .filter((node) => matchTagNames(node, entryTags, tagSelectors).length > 0)
    .map((node) => node.id);
  if (entries.length === 0) return [];

  const signals: Signal[] = [];
  let terminalPathCount = 0;

  const dfs = (pathNodeIds: string[]): void => {
    if (terminalPathCount >= pathCountCap) return;
    const currentId = pathNodeIds[pathNodeIds.length - 1];
    const currentNode = store.getNode(currentId);
    if (!currentNode) return;

    if (pathNodeIds.length > 1) {
      const matchedSinks = matchTagNames(currentNode, sinkTags, tagSelectors);
      if (matchedSinks.length > 0) {
        emitSinkSignals({
          store,
          signals,
          pathNodeIds,
          sinkTags: matchedSinks,
          guardTags,
          tagSelectors,
          hasAnyTestCoverage,
          longPathMinLength,
        });
        terminalPathCount++;
        return;
      }
    }

    const depth = pathNodeIds.length - 1;
    if (depth >= maxDepth) return;

    for (const edgeId of store.outboundEdges(currentId)) {
      if (terminalPathCount >= pathCountCap) return;
      const edge = store.getEdge(edgeId);
      if (!edge) continue;
      if (!isEdgeKindAllowed(edge.kind, allowedEdgeKinds)) continue;

      if (edge.kind === "unknown_dynamic") {
        const dynamicPath = [...pathNodeIds, edge.to];
        signals.push(
          buildPathSignal({
            type: "unknown_dynamic_handoff",
            pathNodeIds: dynamicPath,
            store,
            severityHint: "medium",
            confidenceHint: "low",
            metrics: { pathLength: pathNodeIds.length - 1 },
            metadata: {
              pathNodeIds: dynamicPath,
              dynamicTargetId: edge.to,
              handoffFrom: currentId,
            },
            limitations: [
              "stops at unknown_dynamic edges instead of pretending runtime dispatch is known",
              "static analysis only — runtime receiver types are unknown",
            ],
          }),
        );
        terminalPathCount++;
        continue;
      }

      if (!store.getNode(edge.to)) {
        const degradedPath = [...pathNodeIds, edge.to];
        signals.push(
          buildPathSignal({
            type: "unknown_dynamic_handoff",
            pathNodeIds: degradedPath,
            store,
            severityHint: "medium",
            confidenceHint: "low",
            metrics: { pathLength: pathNodeIds.length - 1 },
            metadata: {
              pathNodeIds: degradedPath,
              missingTarget: true,
              missingTargetId: edge.to,
              handoffFrom: currentId,
              edgeKind: edge.kind,
            },
            limitations: [
              "stops when the graph has an edge but no emitted target node",
              "this is a graph-capability gap, not proof that runtime flow ends here",
            ],
          }),
        );
        terminalPathCount++;
        continue;
      }

      if (pathNodeIds.includes(edge.to)) {
        continue;
      }

      dfs([...pathNodeIds, edge.to]);
    }
  };

  for (const entryId of entries) {
    if (terminalPathCount >= pathCountCap) break;
    dfs([entryId]);
  }

  return signals;
}

function emitSinkSignals(input: {
  store: GraphStore;
  signals: Signal[];
  pathNodeIds: string[];
  sinkTags: string[];
  guardTags: string[];
  tagSelectors: Record<string, { globs?: string[]; symbols?: string[] }>;
  hasAnyTestCoverage: boolean;
  longPathMinLength: number;
}): void {
  const { store, signals, pathNodeIds, sinkTags, guardTags, tagSelectors, hasAnyTestCoverage, longPathMinLength } = input;
  const pathLength = pathNodeIds.length - 1;
  const guardTagsSeen = matchedTagsOnPath(store, pathNodeIds, guardTags, tagSelectors);

  if (pathLength >= longPathMinLength) {
    signals.push(
      buildPathSignal({
        type: "long_path",
        pathNodeIds,
        store,
        severityHint: pathLength >= longPathMinLength + 2 ? "high" : "medium",
        confidenceHint: "medium",
        metrics: { pathLength },
        metadata: {
          pathNodeIds,
          sinkTags,
        },
        limitations: [
          "long path is structural, not proof of runtime execution",
          "dynamic dispatch and framework routing can shorten or bypass the static path",
        ],
      }),
    );
  }

  if (guardTags.length > 0 && guardTagsSeen.length === 0) {
    signals.push(
      buildPathSignal({
        type: "entry_to_sink_without_guard_candidate",
        pathNodeIds,
        store,
        severityHint: "high",
        confidenceHint: "medium",
        metrics: { pathLength },
        metadata: {
          pathNodeIds,
          sinkTags,
          guardTags,
        },
        limitations: [
          "candidate only — guard detection is tag/glob based, not semantic validation",
          "a runtime-only guard outside the static path is invisible here",
        ],
      }),
    );
  }

  if (hasAnyTestCoverage && !pathHasInboundTest(store, pathNodeIds)) {
    signals.push(
      buildPathSignal({
        type: "test_gap_on_public_path",
        pathNodeIds,
        store,
        severityHint: "medium",
        confidenceHint: "low",
        metrics: { pathLength },
        metadata: {
          pathNodeIds,
        },
        limitations: [
          "only checks explicit test_of edges already present in the graph",
          "absence of a test_of edge can be a graph-capability gap, not necessarily a missing test",
        ],
      }),
    );
  }
}

function matchedTagsOnPath(
  store: GraphStore,
  pathNodeIds: string[],
  tagNames: readonly string[],
  tagSelectors: Record<string, { globs?: string[]; symbols?: string[] }>,
): string[] {
  const seen = new Set<string>();
  for (const nodeId of pathNodeIds) {
    const node = store.getNode(nodeId);
    if (!node) continue;
    for (const tagName of matchTagNames(node, tagNames, tagSelectors)) {
      seen.add(tagName);
    }
  }
  return Array.from(seen).sort();
}

function matchTagNames(
  node: GraphNode,
  tagNames: readonly string[],
  tagSelectors: Record<string, { globs?: string[]; symbols?: string[] }>,
): string[] {
  const matched: string[] = [];
  for (const tagName of tagNames) {
    const selector = tagSelectors[tagName] ?? {};
    const pathMatch = node.path && selector.globs && selector.globs.length > 0
      ? matchesAny(node.path, selector.globs)
      : false;
    const symbolMatch = node.symbol && selector.symbols && selector.symbols.length > 0
      ? selector.symbols.includes(node.symbol)
      : false;
    if (pathMatch || symbolMatch) {
      matched.push(tagName);
    }
  }
  return matched;
}

function selectorsFromGlobs(
  tagGlobs: Record<string, string[]>,
): Record<string, { globs?: string[]; symbols?: string[] }> {
  return Object.fromEntries(
    Object.entries(tagGlobs).map(([name, globs]) => [name, { globs }]),
  );
}

function pathHasInboundTest(store: GraphStore, pathNodeIds: string[]): boolean {
  for (const nodeId of pathNodeIds) {
    for (const edgeId of store.inboundEdges(nodeId)) {
      const edge = store.getEdge(edgeId);
      if (edge?.kind === "test_of") return true;
    }
  }
  return false;
}

function buildPathSignal(input: {
  type:
    | "long_path"
    | "entry_to_sink_without_guard_candidate"
    | "unknown_dynamic_handoff"
    | "test_gap_on_public_path";
  pathNodeIds: string[];
  store: GraphStore;
  severityHint: Signal["severityHint"];
  confidenceHint: Signal["confidenceHint"];
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
  limitations: string[];
}): Signal {
  const targetId = pathTargetId(input.pathNodeIds);
  return {
    id: makeSignalId({
      geometryId: "path",
      type: input.type,
      targetId,
      metrics: input.metrics,
    }),
    geometryId: "path",
    type: input.type,
    targetKind: "path",
    targetId,
    anchors: pathAnchors(input.store, input.pathNodeIds),
    severityHint: input.severityHint,
    confidenceHint: input.confidenceHint,
    metrics: input.metrics,
    metadata: input.metadata,
    limitations: input.limitations,
  };
}

function pathTargetId(pathNodeIds: string[]): string {
  const joined = pathNodeIds.join(">");
  return `path:${pathNodeIds[0]}->${pathNodeIds[pathNodeIds.length - 1]}:${sha256Hex16(joined)}`;
}

function pathAnchors(store: GraphStore, pathNodeIds: string[]): Signal["anchors"] {
  return pathNodeIds
    .map((nodeId) => store.getNode(nodeId))
    .filter((node): node is GraphNode => !!node)
    .map((node) => ({
      path: node.path ?? "<unknown>",
      range: node.range,
      symbol: node.symbol,
      source: "source" as const,
    }));
}
