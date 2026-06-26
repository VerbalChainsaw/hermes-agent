/**
 * Config module — public surface.
 *
 * T02-T09 will use loadConfig() to resolve user overrides over defaults
 * and pass the result to the graph builder + engines. The hash returned
 * alongside the config will go in every report header for traceability.
 */

export { loadConfig } from "./load.js";
export type { LoadFailure, LoadSuccess, LoadResult } from "./load.js";

export { validateConfig } from "./validate.js";
export type { ValidationError, ValidationResult } from "./validate.js";

export { hashConfig, canonicalise, fnv1a64 } from "./hash.js";

export { DEFAULT_CONFIG } from "./default.js";

export type {
  BoundaryCrossing,
  BoundaryTag,
  BoundariesConfig,
  CIConfig,
  CIFailOn,
  Config,
  EnginesConfig,
  EngineConfig,
  FileSetConfig,
  Glob,
  PathPattern,
  ReportConfig,
  ScoringConfig,
} from "./types.js";
