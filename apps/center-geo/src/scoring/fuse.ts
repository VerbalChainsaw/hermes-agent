/**
 * Signal fusion + scoring (T14).
 *
 * Aggregates signals from all 5 engines (radial, cycle, boundary,
 * anomaly, convergent) into per-target FusedScore[] using the
 * 8-bonus formula from config.scoring.
 *
 * Algorithm:
 *   1. Group signals by targetId (one FusedScore per target).
 *   2. For each group, compute bonuses:
 *      - geometry_bonus_per_extra_geometry × (geometries - 1)
 *        (= 0 if only one engine flagged; positive bonus if multiple)
 *      - independence_bonus_per_extra_independent_method × (edgeKinds - 1)
 *        (= 0 if only one kind flagged; positive bonus if multiple)
 *      - boundary_bonus × (count of boundary_violation signals)
 *      - state_bonus × (count of state_* signals)
 *      - cycle_bonus × (count of cycle_detected signals)
 *      - test_gap_bonus × (count of test_gap signals; reserved for T20+)
 *   3. Penalties:
 *      - contradiction_penalty × (count of contradictory signal pairs)
 *        (heuristic: same target with opposite severity hints)
 *      - capability_gap_penalty × (count of capability_gap signals;
 *        reserved for T20+)
 *   4. Total score = sum of bonuses - sum of penalties, clamped to
 *      [0, ∞) (we don't go negative — a target with no signals has
 *      score 0, a target with all positive signals has the max).
 *
 * Determinism: contributions are processed in sorted signal-id order
 * so two runs on the same inputs produce the same output.
 *
 * Limitations:
 *   - The 8-bonus formula is heuristic; it has NOT been calibrated
 *     against historical defect rates.
 *   - The contradiction detection is simple (opposite severity
 *     pairs on same target); a richer model would use signal-type
 *     pairs that imply logical contradiction.
 */

import { SEVERITY_RANK, type Signal, type SeverityHint } from "../engines/radial/signals.js";
import type { ScoringConfig } from "../config/types.js";
import type { FusedScore } from "./types.js";

/**
 * Compute the higher of two severities (the one ranked higher in
 * SEVERITY_RANK). If equal, returns `a`.
 */
function maxSeverity(a: SeverityHint, b: SeverityHint): SeverityHint {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

/**
 * Compute the sha256-based id for a fused score. Inputs are
 * normalized: targetId + sorted signal ids. This guarantees the
 * same fused score id across runs (deterministic).
 */
import { createHash } from "node:crypto";

function fusedScoreId(targetId: string, signalIds: readonly string[]): string {
  const h = createHash("sha256");
  h.update(targetId);
  h.update("\n");
  for (const id of [...signalIds].sort()) {
    h.update(id);
    h.update("\n");
  }
  return "f:" + h.digest("hex").slice(0, 16);
}

/**
 * Fuse the given signals into per-target FusedScore[]. Returns the
 * scores sorted by score DESC, then by targetId ASC for stable
 * ordering.
 *
 * `config` is the full ScoringConfig. Signals that don't match any
 * bonus or penalty formula contribute geometry_bonus_per_extra_geometry
 * (via the geometry count) but no other components.
 */
export function fuseSignals(
  signals: readonly Signal[],
  config: ScoringConfig,
): FusedScore[] {
  // Group signals by targetId.
  const byTarget = new Map<string, Signal[]>();
  for (const sig of signals) {
    const list = byTarget.get(sig.targetId);
    if (list) list.push(sig);
    else byTarget.set(sig.targetId, [sig]);
  }

  const out: FusedScore[] = [];

  for (const [targetId, sigs] of byTarget) {
    // Collect distinct geometries, edge kinds, severities.
    const geometries = new Set<string>();
    const edgeKinds = new Set<string>();
    let maxSev: SeverityHint = "info";

    for (const sig of sigs) {
      geometries.add(sig.geometryId);
      // Edge kind is encoded in some signals' metadata.edgeKind.
      // For others (radial, anomaly, convergent) there's no specific
      // edge kind. We pull from metadata if present, else fall back
      // to a generic bucket keyed by geometry.
      const ek = (sig.metadata as { edgeKind?: string } | undefined)?.edgeKind;
      if (ek) edgeKinds.add(ek);
      else edgeKinds.add(`<${sig.geometryId}>`);
      maxSev = maxSeverity(maxSev, sig.severityHint);
    }

    // Count signal-type buckets for the bonus formulas.
    let boundaryCount = 0;
    let stateCount = 0;
    let cycleCount = 0;
    let testGapCount = 0;
    let capabilityGapCount = 0;
    for (const sig of sigs) {
      if (sig.type === "boundary_violation") boundaryCount++;
      if (sig.type.startsWith("state_")) stateCount++;
      if (sig.type === "cycle_detected") cycleCount++;
      // test_gap_* and capability_gap_* signal types land with T20+.
      // We count them defensively so future tickets light up.
      if (sig.type.startsWith("test_gap")) testGapCount++;
      if (sig.type.startsWith("capability_gap")) capabilityGapCount++;
    }

    // Contradiction detection: any pair of signals on this target
    // with opposite severity extremes (info vs critical) suggests
    // contradictory information. Simple heuristic: count pairs where
    // min_severity = info AND max_severity = critical within the
    // signal group.
    let contradictionPairs = 0;
    let minSev: SeverityHint = maxSev;
    for (const sig of sigs) {
      if (SEVERITY_RANK[sig.severityHint] < SEVERITY_RANK[minSev]) {
        minSev = sig.severityHint;
      }
    }
    if (sigs.length > 1 && SEVERITY_RANK[minSev] === SEVERITY_RANK.info && SEVERITY_RANK[maxSev] === SEVERITY_RANK.critical) {
      contradictionPairs = 1; // one contradictory pair per group
    }

    const geometryBonus =
      Math.max(0, geometries.size - 1) *
      config.geometry_bonus_per_extra_geometry;
    const independenceBonus =
      Math.max(0, edgeKinds.size - 1) *
      config.independence_bonus_per_extra_independent_method;
    const boundaryBonus = boundaryCount * config.boundary_bonus;
    const stateBonus = stateCount * config.state_bonus;
    const cycleBonus = cycleCount * config.cycle_bonus;
    const testGapBonus = testGapCount * config.test_gap_bonus;
    const contradictionPenalty =
      contradictionPairs * config.contradiction_penalty;
    const capabilityGapPenalty =
      capabilityGapCount * config.capability_gap_penalty;

    const raw =
      geometryBonus +
      independenceBonus +
      boundaryBonus +
      stateBonus +
      cycleBonus +
      testGapBonus -
      contradictionPenalty -
      capabilityGapPenalty;
    const score = Math.max(0, raw);

    out.push({
      id: fusedScoreId(targetId, sigs.map((s) => s.id)),
      targetId,
      targetKind: sigs[0].targetKind,
      score,
      maxSeverity: maxSev,
      geometries: [...geometries].sort(),
      edgeKinds: [...edgeKinds].sort(),
      contributors: sigs,
      components: {
        geometryBonus,
        independenceBonus,
        boundaryBonus,
        stateBonus,
        cycleBonus,
        testGapBonus,
        contradictionPenalty,
        capabilityGapPenalty,
      },
    });
  }

  // Sort by score DESC, targetId ASC for determinism.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
  });

  return out;
}