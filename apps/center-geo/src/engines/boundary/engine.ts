/**
 * Boundary engine (T11).
 *
 * Per docs/01 §FR5 and docs/08 T11 acceptance:
 *   - emits a `boundary_violation` signal for every edge that crosses
 *     a forbidden boundary tag combination
 *   - respects `config.boundaries.forbidden_crossings`
 *   - includes path evidence (the violating edge's anchor)
 *   - emits at most ONE signal per forbidden-crossing RULE per edge
 *     (so an edge crossing two forbidden pairs emits two signals, one
 *     for each rule; an edge crossing no forbidden pairs emits zero).
 *
 * The engine classifies file nodes by glob match against
 * `config.boundaries.tags`. A file is in boundary `T` if its path
 * matches ANY of `T.globs`. If a file matches multiple tag globs, it
 * belongs to all of them (intentional — UI can also be persistence
 * in pathological cases).
 *
 * Tag-to-tag match is direction-agnostic: if `forbidden_crossings`
 * lists `["ui", "persistence"]` and an edge connects a `ui` file to
 * a `persistence` file, the engine emits a violation regardless of
 * which side is the source.
 *
 * Per docs/01 §G3 + §FR7, signals are HYPOTHESES — not defects.
 * Every signal carries anchors, metrics, and limitations.
 */

import { isEdgeKindAllowed, makeSignalId, type Signal } from "../radial/signals.js";
import { matchesAny } from "../../enumerate/glob.js";
import type { BoundariesConfig } from "../../config/types.js";
import type { EdgeKind, GraphStore } from "../../graph/index.js";

/**
 * Per-crossing config. Re-exported for the CLI runner. The engine
 * itself takes the full BoundariesConfig — this is just a type alias
 * for the bits the engine actually consumes.
 */
export type BoundaryEngineConfig = BoundariesConfig;

/**
 * Classify a file's path into the set of boundary tags it belongs to.
 * Returns the names of the matching tags. An empty array means the
 * file is not in any boundary (common case — most files aren't
 * tagged).
 *
 * This is recomputed for every file once per scan (O(N * T * G) where
 * T = number of tags, G = average globs per tag). For 10k files, 5
 * tags, 3 globs each = 150k glob tests; with picomatch factory this
 * is well under 100ms.
 */
function classifyBoundary(
  relativePosix: string,
  config: BoundariesConfig,
): string[] {
  const matched: string[] = [];
  for (const [tagName, tagDef] of Object.entries(config.tags)) {
    // `globs` is the primary path classifier. `symbols` is symbol-level
    // (out of scope for T11's file-level pass).
    const globs: string[] = tagDef.globs ?? [];
    if (globs.length > 0 && matchesAny(relativePosix, globs)) {
      matched.push(tagName);
    }
  }
  return matched;
}

/**
 * Find the first forbidden-crossing rule (if any) that matches the
 * ordered pair of tags. The match is symmetric: if rule `{from: "ui",
 * to: "persistence"}` is registered, the engine matches BOTH
 * `("ui", "persistence")` and `("persistence", "ui")`.
 *
 * Returns the matching rule's severity, or null if no rule applies.
 */
function findForbiddenRule(
  tagA: string,
  tagB: string,
  config: BoundariesConfig,
): { severity: "low" | "medium" | "high" | "critical"; reason: string } | null {
  for (const rule of config.forbidden_crossings) {
    if (
      (rule.from === tagA && rule.to === tagB) ||
      (rule.from === tagB && rule.to === tagA)
    ) {
      return { severity: rule.severity, reason: rule.reason };
    }
  }
  return null;
}

/**
 * Numeric weight for a severity hint. Used as a metric in the
 * deterministic signal id (which requires `Record<string, number>`).
 * Higher weight = more severe. Stable order, no future-proofing for
 * new severities (those land in a follow-up if added).
 */
function severityWeight(
  s: "low" | "medium" | "high" | "critical",
): number {
  switch (s) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
  }
}

/**
 * Run the boundary engine. Emits a `boundary_violation` signal for
 * every edge whose two endpoints are in boundary tags that the config
 * forbids. Skips edges that are not in the allowed_edge_kinds set
 * (defaults: all edge kinds, matching the radial engine's "no
 * restriction" semantics).
 *
 * Singleton singleton config (no tags defined OR no forbidden
 * crossings) returns empty.
 */
export function runBoundaryEngine(
  store: GraphStore,
  config: BoundaryEngineConfig,
  options: { allowedEdgeKinds?: readonly EdgeKind[] } = {},
): Signal[] {
  // If the config has no tags or no forbidden crossings, there's
  // nothing to check. Bail early to avoid a full-graph pass.
  const tagCount = Object.keys(config.tags).length;
  const crossingCount = config.forbidden_crossings.length;
  if (tagCount === 0 || crossingCount === 0) return [];

  const allowedEdgeKinds = options.allowedEdgeKinds;

  // Pre-compute boundary membership for every file. This is the
  // hot loop; the file→tag map is built once and reused.
  const fileToTags = new Map<string, string[]>();
  for (const node of store.allNodes()) {
    if (node.kind !== "file") continue;
    if (!node.path) continue;
    // The store keeps paths in their canonical form; classifyBoundary
    // expects a posix-style relative path. The enumerator normalizes
    // via toPosixPath before storing, so node.path is already posix.
    // We just trim a leading "./" if present to be safe.
    const relPosix = node.path.replace(/^\.\//, "");
    const tags = classifyBoundary(relPosix, config);
    if (tags.length > 0) {
      fileToTags.set(node.id, tags);
    }
  }

  // If no file node maps to a boundary, the engine has nothing to do.
  if (fileToTags.size === 0) return [];

  const signals: Signal[] = [];
  const seen = new Set<string>(); // dedup: same (edge, rule) emits one signal

  for (const edge of store.allEdges()) {
    if (!isEdgeKindAllowed(edge.kind, allowedEdgeKinds)) continue;

    const tagsA = fileToTags.get(edge.from);
    const tagsB = fileToTags.get(edge.to);
    if (!tagsA || !tagsB) continue;
    // Both endpoints must be in at least one boundary.

    for (const a of tagsA) {
      for (const b of tagsB) {
        if (a === b) continue; // same boundary — not a violation
        const rule = findForbiddenRule(a, b, config);
        if (!rule) continue;
        const dedupKey = `${edge.id}::${a}::${b}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const fromNode = store.getNode(edge.from);
        const toNode = store.getNode(edge.to);
        const anchors: Signal["anchors"] = [];
        const a0 = edge.anchors[0];
        anchors.push({
          path: a0?.path ?? fromNode?.path ?? "<unknown>",
          range: a0?.range,
          symbol: a0?.symbol ?? edge.from,
          source: "source",
        });
        if (toNode) {
          anchors.push({
            path: toNode.path ?? "<unknown>",
            range: toNode.range,
            symbol: toNode.symbol,
            source: "source",
          });
        }

        signals.push({
          id: makeSignalId({
            geometryId: "boundary",
            type: "boundary_violation",
            targetId: edge.id,
            // metrics must be Record<string, number> for the deterministic
            // hash. String tag names go in metadata instead.
            metrics: { forbiddenCrossingSeverityWeight: severityWeight(rule.severity) },
          }),
          geometryId: "boundary",
          type: "boundary_violation",
          targetKind: "edge",
          targetId: edge.id,
          anchors,
          severityHint: rule.severity,
          confidenceHint: "high",
          metrics: {
            forbiddenCrossingSeverityWeight: severityWeight(rule.severity),
          },
          metadata: {
            reason: rule.reason,
            fromBoundary: a,
            toBoundary: b,
            edgeFrom: edge.from,
            edgeTo: edge.to,
            edgeKind: edge.kind,
          },
          limitations: [
            "boundary classification is glob-based — files matching multiple globs are tagged with all matches",
            "tag-to-tag match is symmetric — direction of the rule (from/to) is preserved for reporting but does not affect detection",
            "static boundaries only — runtime boundary checks (e.g. authorization middleware) are not detected by the parser",
          ],
        });
      }
    }
  }

  return signals;
}
