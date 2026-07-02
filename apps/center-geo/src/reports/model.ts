import type { Config } from "../config/types.js";
import type { Confidence, GraphWarning, CoverageStats, Anchor, GraphSnapshot } from "../graph/types.js";
import type { Signal } from "../engines/radial/signals.js";
import type { FusedScore } from "../scoring/types.js";

export interface CoverageReport extends CoverageStats {}

export interface EngineRunReport {
  geometry_id: string;
  status: "completed" | "skipped" | "error";
  signal_count?: number;
}

export interface ScanFrameReport {
  root: string;
  mode: string;
  config_hash: string;
  graph_id?: string;
  revision?: GraphSnapshot["revision"];
}

export interface SignalReport {
  id: string;
  geometry_id: string;
  type: string;
  target: Record<string, unknown>;
  severity_hint: string;
  confidence_hint: string;
  evidence: Anchor[];
  metrics: Record<string, number>;
  explanation: string;
  limitations: string[];
}

export interface HypothesisScoreReport {
  rank_score: number;
  severity: string;
  confidence: Confidence;
  geometry_count: number;
  evidence_count: number;
  independence_count: number;
  calculation_notes: string[];
}

export interface InvestigationPacketReport {
  objective: string;
  suspected_invariant: string;
  suggested_center_anchors: Anchor[];
  first_questions: string[];
  forbidden_scope: string[];
  recommended_verification: string[];
}

export interface ContradictionReport {
  id: string;
  description: string;
  signal_ids: string[];
  effect: "lowers_confidence" | "requires_human_review" | "blocks_confirmation";
}

export interface ReportHypothesis {
  id: string;
  title: string;
  status: "hypothesis";
  target: Record<string, unknown>;
  contributing_signal_ids: string[];
  contributing_geometries: string[];
  score: HypothesisScoreReport;
  explanation: string;
  investigation_packet: InvestigationPacketReport;
  contradictions: ContradictionReport[];
  limitations: string[];
  targetId: string;
  targetKind: FusedScore["targetKind"];
  maxSeverity: FusedScore["maxSeverity"];
  geometries: string[];
  edgeKinds: string[];
  contributors: Signal[];
  components: FusedScore["components"];
}

export interface ReportMeta {
  toolVersion: string;
  scanFrame: ScanFrameReport;
  engineRuns: EngineRunReport[];
  signals: Signal[];
  warnings: GraphWarning[];
}

export interface JsonReport {
  schema_version: "1.0.0";
  tool_version: string;
  scan_frame: ScanFrameReport;
  count: number;
  raw_signal_count: number;
  coverage: CoverageReport;
  engine_runs: EngineRunReport[];
  signals: SignalReport[];
  hypotheses: ReportHypothesis[];
  warnings: GraphWarning[];
}

const ENGINE_ORDER = ["radial", "cycle", "boundary", "anomaly", "convergent", "path"] as const;
const CONFIDENCE_RANK: Record<Confidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function buildEngineRuns(
  config: Config,
  signals: readonly Signal[],
): EngineRunReport[] {
  return ENGINE_ORDER.map((geometryId) => ({
    geometry_id: geometryId,
    status: config.engines[geometryId].enabled === false ? "skipped" : "completed",
    signal_count: signals.filter((signal) => signal.geometryId === geometryId).length,
  }));
}

export function buildScanFrame(snapshot: GraphSnapshot): ScanFrameReport {
  return {
    root: snapshot.root,
    mode: "scan",
    config_hash: snapshot.config_hash,
    graph_id: snapshot.graph_id,
    revision: snapshot.revision,
  };
}

export function buildJsonReport(
  fused: readonly FusedScore[],
  topN: number,
  rawSignalCount: number,
  coverage: CoverageReport,
  meta?: Partial<ReportMeta>,
): JsonReport {
  const top = fused.slice(0, topN);
  const signals = meta?.signals ?? [];
  return {
    schema_version: "1.0.0",
    tool_version: meta?.toolVersion ?? "0.0.0",
    scan_frame: {
      root: meta?.scanFrame?.root ?? ".",
      mode: meta?.scanFrame?.mode ?? "scan",
      config_hash: meta?.scanFrame?.config_hash ?? "unknown",
      graph_id: meta?.scanFrame?.graph_id,
      revision: meta?.scanFrame?.revision ?? { vcs: "unknown" },
    },
    count: top.length,
    raw_signal_count: rawSignalCount,
    coverage,
    engine_runs: meta?.engineRuns ?? [],
    signals: signals.map(toSignalReport),
    hypotheses: top.map(toHypothesisReport),
    warnings: meta?.warnings ?? [],
  };
}

export function toSignalReport(signal: Signal): SignalReport {
  return {
    id: signal.id,
    geometry_id: signal.geometryId,
    type: signal.type,
    target: toSignalTarget(signal),
    severity_hint: signal.severityHint,
    confidence_hint: signal.confidenceHint,
    evidence: signal.anchors,
    metrics: signal.metrics,
    explanation: describeSignal(signal),
    limitations: signal.limitations,
  };
}

export function toHypothesisReport(hypothesis: FusedScore): ReportHypothesis {
  const evidenceCount = hypothesis.contributors.reduce((sum, contributor) => sum + contributor.anchors.length, 0);
  const target = toTargetFromContributors(hypothesis);
  const contradictions = detectContradictions(hypothesis);
  const calculationNotes = buildCalculationNotes(hypothesis, contradictions.length > 0);
  const limitations = Array.from(new Set([
    ...hypothesis.contributors.flatMap((contributor) => contributor.limitations),
    "Hypotheses are ranking aids, not confirmed defects.",
  ])).sort();
  const confidence = aggregateConfidence(hypothesis.contributors);
  return {
    id: hypothesis.id,
    title: buildHypothesisTitle(hypothesis),
    status: "hypothesis",
    target,
    contributing_signal_ids: hypothesis.contributors.map((contributor) => contributor.id),
    contributing_geometries: hypothesis.geometries,
    score: {
      rank_score: hypothesis.score,
      severity: hypothesis.maxSeverity,
      confidence,
      geometry_count: hypothesis.geometries.length,
      evidence_count: evidenceCount,
      independence_count: hypothesis.edgeKinds.length,
      calculation_notes: calculationNotes,
    },
    explanation: buildHypothesisExplanation(hypothesis),
    investigation_packet: buildInvestigationPacket(hypothesis),
    contradictions,
    limitations,
    targetId: hypothesis.targetId,
    targetKind: hypothesis.targetKind,
    maxSeverity: hypothesis.maxSeverity,
    geometries: hypothesis.geometries,
    edgeKinds: hypothesis.edgeKinds,
    contributors: hypothesis.contributors,
    components: hypothesis.components,
  };
}

function toSignalTarget(signal: Signal): Record<string, unknown> {
  switch (signal.targetKind) {
    case "node":
      return { kind: "node", node_id: signal.targetId };
    case "edge": {
      const metadata = signal.metadata as Record<string, unknown>;
      if (typeof metadata.fromBoundary === "string" && typeof metadata.toBoundary === "string") {
        return {
          kind: "boundary",
          boundary_id: `${metadata.fromBoundary}->${metadata.toBoundary}`,
          node_ids: [metadata.edgeFrom, metadata.edgeTo].filter((value): value is string => typeof value === "string"),
          edge_ids: [signal.targetId],
        };
      }
      return { kind: "edge", edge_id: signal.targetId };
    }
    case "path": {
      const metadata = signal.metadata as Record<string, unknown>;
      return {
        kind: "path",
        node_ids: Array.isArray(metadata.pathNodeIds) ? metadata.pathNodeIds : [],
        edge_ids: Array.isArray(metadata.pathEdgeIds) ? metadata.pathEdgeIds : [],
      };
    }
    case "subgraph": {
      const metadata = signal.metadata as Record<string, unknown>;
      return {
        kind: "subgraph",
        node_ids: Array.isArray(metadata.members) ? metadata.members : [],
        edge_ids: Array.isArray(metadata.internalEdgeIds) ? metadata.internalEdgeIds : [],
      };
    }
    case "metric": {
      const metadata = signal.metadata as Record<string, unknown>;
      return {
        kind: "metric",
        metric_name: typeof metadata.metric === "string" ? metadata.metric : signal.type,
        node_ids: Array.isArray(metadata.nodeIds) ? metadata.nodeIds : [],
      };
    }
    case "boundary": {
      const metadata = signal.metadata as Record<string, unknown>;
      return {
        kind: "boundary",
        boundary_id: typeof metadata.boundaryId === "string" ? metadata.boundaryId : signal.targetId,
        node_ids: Array.isArray(metadata.nodeIds) ? metadata.nodeIds : [],
        edge_ids: Array.isArray(metadata.edgeIds) ? metadata.edgeIds : [],
      };
    }
    default:
      return { kind: signal.targetKind, target_id: signal.targetId };
  }
}

function toTargetFromContributors(hypothesis: FusedScore): Record<string, unknown> {
  const primary = hypothesis.contributors[0];
  if (primary) {
    return toSignalTarget(primary);
  }
  switch (hypothesis.targetKind) {
    case "node":
      return { kind: "node", node_id: hypothesis.targetId };
    case "edge":
      return { kind: "edge", edge_id: hypothesis.targetId };
    default:
      return { kind: hypothesis.targetKind, target_id: hypothesis.targetId };
  }
}

function describeSignal(signal: Signal): string {
  const targetLabel = `${signal.targetKind} ${signal.targetId}`;
  if (signal.geometryId === "boundary") {
    const metadata = signal.metadata as Record<string, unknown>;
    if (typeof metadata.fromBoundary === "string" && typeof metadata.toBoundary === "string") {
      return `Boundary geometry found a configured forbidden crossing from ${metadata.fromBoundary} to ${metadata.toBoundary}.`;
    }
  }
  if (signal.geometryId === "cycle") {
    return `Cycle geometry found a structural cycle touching ${targetLabel}.`;
  }
  if (signal.geometryId === "path") {
    return `Path geometry surfaced a path-shaped investigation lead for ${targetLabel}.`;
  }
  if (signal.geometryId === "anomaly") {
    return `Anomaly geometry flagged ${targetLabel} as structurally unusual.`;
  }
  if (signal.geometryId === "convergent") {
    return `Convergent geometry found multiple independent branches feeding ${targetLabel}.`;
  }
  return `${signal.geometryId} geometry emitted ${signal.type} for ${targetLabel}.`;
}

function buildHypothesisTitle(hypothesis: FusedScore): string {
  const primary = hypothesis.contributors[0];
  if (primary?.geometryId === "boundary") {
    const metadata = primary.metadata as Record<string, unknown>;
    if (typeof metadata.fromBoundary === "string" && typeof metadata.toBoundary === "string") {
      return `${metadata.fromBoundary} crosses forbidden ${metadata.toBoundary} boundary`;
    }
  }
  if (primary?.geometryId === "cycle") {
    return `Cycle cluster surfaced at ${hypothesis.targetId}`;
  }
  if (primary?.geometryId === "path") {
    return `Path-risk lead surfaced at ${hypothesis.targetId}`;
  }
  if (hypothesis.geometries.length > 1) {
    return `${hypothesis.targetKind} ${hypothesis.targetId} surfaced across ${hypothesis.geometries.length} geometries`;
  }
  return `${hypothesis.targetKind} ${hypothesis.targetId} surfaced in ${hypothesis.geometries[0] ?? "scanner"}`;
}

function buildHypothesisExplanation(hypothesis: FusedScore): string {
  const geometries = hypothesis.geometries.join(", ");
  return (
    `Evidence from ${geometries || "the scanner"} raised this ${hypothesis.targetKind} as a structural risk hypothesis. ` +
    `The fused rank prioritizes investigation order; it is not proof of a defect.`
  );
}

function buildInvestigationPacket(hypothesis: FusedScore): InvestigationPacketReport {
  const anchors = hypothesis.contributors.flatMap((contributor) => contributor.anchors).slice(0, 5);
  return {
    objective: `Verify whether ${hypothesis.targetKind} ${hypothesis.targetId} represents a real architectural or behavioral defect.`,
    suspected_invariant: `The system should not require ${hypothesis.targetKind} ${hypothesis.targetId} to carry this level of multi-geometry structural risk.`,
    suggested_center_anchors: anchors,
    first_questions: [
      `Which contributor produced the highest-severity evidence for ${hypothesis.targetId}?`,
      `Does the cited path or boundary exist in production code, or only in scaffolding/tests?`,
      `Can the strongest signal be falsified by configuration, dead code, or generated wiring?`,
    ],
    forbidden_scope: [
      "Do not treat this hypothesis as a confirmed bug without focused audit or reproduction.",
      "Do not widen the repair beyond the cited target until the causal path is verified.",
    ],
    recommended_verification: [
      "Trace the highest-severity anchors in the built artifact or current source tree.",
      "Run a focused CENTER-AUDIT or equivalent root-cause review on the cited target.",
      "Check whether the path is test-only, generated, or configuration-derived noise before editing code.",
    ],
  };
}

function detectContradictions(hypothesis: FusedScore): ContradictionReport[] {
  const severities = hypothesis.contributors.map((contributor) => contributor.severityHint);
  const hasInfo = severities.some((severity) => severity === "info");
  const hasCritical = severities.some((severity) => severity === "critical");
  if (!hasInfo || !hasCritical) {
    return [];
  }
  return [
    {
      id: `contradiction:${hypothesis.id}`,
      description: "Contributors disagree from informational to critical severity; human review should validate the premise before repair.",
      signal_ids: hypothesis.contributors.map((contributor) => contributor.id),
      effect: "requires_human_review",
    },
  ];
}

function buildCalculationNotes(hypothesis: FusedScore, hasContradiction: boolean): string[] {
  const notes: string[] = [];
  if (hypothesis.geometries.length > 1) {
    notes.push(`${hypothesis.geometries.length} geometries contributed evidence.`);
  } else {
    notes.push("Single geometry contribution only.");
  }
  if (hypothesis.edgeKinds.length > 1) {
    notes.push(`${hypothesis.edgeKinds.length} independent edge-kind buckets contributed.`);
  }
  if (hypothesis.components.boundaryBonus > 0) notes.push("Boundary bonus applied.");
  if (hypothesis.components.stateBonus > 0) notes.push("State bonus applied.");
  if (hypothesis.components.cycleBonus > 0) notes.push("Cycle bonus applied.");
  if (hypothesis.components.testGapBonus > 0) notes.push("Test-gap bonus applied.");
  if (hypothesis.components.capabilityGapPenalty > 0) notes.push("Capability-gap penalty applied.");
  if (hasContradiction || hypothesis.components.contradictionPenalty > 0) {
    notes.push("Contradictory evidence lowered confidence and requires human review.");
  }
  notes.push(`Highest contributor severity: ${hypothesis.maxSeverity}.`);
  return notes;
}

function aggregateConfidence(signals: readonly Signal[]): Confidence {
  let best: Confidence = "unknown";
  for (const signal of signals) {
    if (CONFIDENCE_RANK[signal.confidenceHint] > CONFIDENCE_RANK[best]) {
      best = signal.confidenceHint;
    }
  }
  return best;
}
