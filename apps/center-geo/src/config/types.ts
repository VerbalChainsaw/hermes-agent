/**
 * Configuration types for center-geo.
 *
 * The shape mirrors examples/center-geometry.config.yaml from the
 * requirements package. Field names are intentionally identical to
 * the YAML keys (camelCase) so the parsed config object mirrors the
 * file structure 1:1 — easier to reason about, easier to round-trip,
 * easier to debug when a report references config-derived values.
 *
 * Validation is hand-rolled (see validate.ts) rather than JSON-schema
 * because the schema is small and the error messages from a hand-rolled
 * validator are more actionable for end users.
 */

import type { EdgeKind } from "../graph/types.js";

/** Glob pattern as a string. Validated as non-empty. */
export type Glob = string;

/** A path or glob identifying a set of files. */
export type PathPattern = Glob;

/**
 * A boundary tag groups files or symbols into a logical layer. The
 * `forbidden_crossings` list says which tag-to-tag edges are not
 * allowed; `severity` controls how much scoring weight the engine
 * applies when such an edge appears in the graph.
 */
export interface BoundaryTag {
  globs?: PathPattern[];
  symbols?: string[];
}

export interface BoundaryCrossing {
  from: string;
  to: string;
  severity: "low" | "medium" | "high" | "critical";
  reason: string;
}

export interface BoundariesConfig {
  tags: Record<string, BoundaryTag>;
  forbidden_crossings: BoundaryCrossing[];
}

/**
 * One geometry engine's per-engine config. The shipped engines are radial,
 * cycle, boundary, anomaly, convergent, path — see docs/01 §FR6. T08-T09 will
 * define the schema per engine; this interface is the common shell.
 */
export interface EngineConfig {
  enabled: boolean;
  max_depth?: number;
  max_nodes?: number;
  /**
   * Edge kinds this engine is allowed to traverse. If undefined or
   * empty, all edge kinds are allowed (per `isEdgeKindAllowed` in
   * engines/radial/signals.ts — both undefined and [] mean "no
   * restriction"). This is the parsed/narrowed type, not a free-form
   * `string[]`, so the static type system catches typos at the call
   * site (e.g. "imports" vs "import").
   */
  allowed_edge_kinds?: readonly EdgeKind[];
  /**
   * Engine-specific knobs land here. Cycle engine uses `max_cycle_size`:
   * skip cycles with more than this many nodes. Radial engine ignores
   * this; boundary / anomaly / convergent will define their own.
   */
  [key: string]: unknown;
  max_cycle_size?: number;
}

export interface EnginesConfig {
  radial: EngineConfig;
  cycle: EngineConfig;
  boundary: EngineConfig;
  anomaly: EngineConfig;
  convergent: EngineConfig;
  path: EngineConfig;
}

export interface ScoringConfig {
  geometry_bonus_per_extra_geometry: number;
  independence_bonus_per_extra_independent_method: number;
  boundary_bonus: number;
  state_bonus: number;
  cycle_bonus: number;
  test_gap_bonus: number;
  contradiction_penalty: number;
  capability_gap_penalty: number;
}

export interface CIFailOn {
  new_critical_hypotheses?: boolean;
  new_forbidden_boundary_crossings?: boolean;
  parse_failure_rate_over?: number;
  new_cycles_over?: number;
}

export interface CIConfig {
  fail_on: CIFailOn;
}

export interface ReportConfig {
  top_n_hypotheses: number;
  redact: boolean;
}

export interface FileSetConfig {
  globs: PathPattern[];
}

/**
 * Top-level config. All fields are required after defaults are merged;
 * the loader never returns a partial config.
 */
export interface Config {
  include: PathPattern[];
  exclude: PathPattern[];
  generated?: FileSetConfig;
  tests?: FileSetConfig;
  boundaries?: BoundariesConfig;
  sinks?: Record<string, FileSetConfig>;
  engines: EnginesConfig;
  scoring: ScoringConfig;
  ci?: CIConfig;
  report: ReportConfig;
}
