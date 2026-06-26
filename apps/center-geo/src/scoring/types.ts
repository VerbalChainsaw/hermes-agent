/**
 * Scoring + fusion types (T14).
 *
 * Per docs/01 §FR5 (ScoringConfig) and §FR7 (signal contract), T14 takes
 * raw Signal[] output from all 5 engines and produces a per-node
 * FusedScore[]. Each FusedScore aggregates all signals that touched
 * a node and computes a score from the 8-bonus formula in
 * config.scoring.
 *
 * Per docs/01 §G4: "Each flag is a HYPOTHESIS, not a defect. Fusion
 * is a SCORE that prioritizes what to investigate first — not a
 * verdict." FusedScores carry the source signals as evidence
 * (falsifiable later by an analyst).
 */

import type { Signal } from "../engines/radial/signals.js";

/**
 * A fused score for a single node, edge, or subgraph target. Targets
 * can repeat across engines — fusion collapses them.
 */
export interface FusedScore {
  /** Stable id (deterministic; SHA-256 of the normalized target + signal ids). */
  id: string;
  /** The target this fused score is for (a node, edge, or subgraph id). */
  targetId: string;
  /** What kind of target (forwarded from the source signal). */
  targetKind: "node" | "edge" | "path" | "subgraph" | "metric" | "boundary";
  /**
   * The aggregated fused score (sum of bonuses and penalties across all
   * signals touching this target). Higher = more attention-worthy.
   */
  score: number;
  /** Maximum severityHint seen across the source signals. */
  maxSeverity: Signal["severityHint"];
  /** Distinct geometries that contributed signals for this target. */
  geometries: string[];
  /** Distinct edge kinds that contributed signals for this target. */
  edgeKinds: string[];
  /**
   * The raw signals that contributed. Stored for traceability; the
   * fusion is derived data, the signals are the source of truth.
   */
  contributors: Signal[];
  /**
   * Breakdown of bonus/penalty components. Useful for explainability
   * ("why is this score high?").
   */
  components: {
    geometryBonus: number;
    independenceBonus: number;
    boundaryBonus: number;
    stateBonus: number;
    cycleBonus: number;
    testGapBonus: number;
    contradictionPenalty: number;
    capabilityGapPenalty: number;
  };
}