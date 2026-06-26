/**
 * @hermes/center-geo — CENTER-MULTIGEOMETRY
 *
 * Deterministic multi-geometry structural risk scanner for codebases.
 * Companion to center-audit.
 *
 * Public package surface. Engines (T08+) and adapters (T05+) import
 * shared types and constants from here so the dependency direction is
 * always leaf → root, never leaf → CLI module.
 */

import pkg from "../package.json" with { type: "json" };

/**
 * Exit codes from the spec (docs/01-product-requirements.md FR10). Defined
 * as a `const` object literal with `as const` so the union type can be
 * derived (see ExitCodeValue below). Lives at the package root so engine
 * code (T08+) and CLI code (T00) both import from here.
 */
export const ExitCode = {
  /** Scan completed, no threshold exceeded. */
  OK: 0,
  /** Scan completed, threshold exceeded. */
  THRESHOLD: 1,
  /** Scan completed with extraction gaps above configured tolerance. */
  EXTRACTION_GAP: 2,
  /** Configuration error. */
  CONFIG_ERROR: 3,
  /** Repository read error. */
  REPO_READ_ERROR: 4,
  /** Internal tool error. */
  INTERNAL: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export const PACKAGE_NAME = pkg.name;
export const PACKAGE_VERSION = pkg.version;

// Re-export the config module's public surface so engines (T08+) and
// adapters (T05+) can do `import { Config, loadConfig } from "@hermes/center-geo"`
// without reaching into a subpath that isn't in the exports map yet.
export {
  loadConfig,
  validateConfig,
  hashConfig,
  canonicalise,
  fnv1a64,
  DEFAULT_CONFIG,
} from "./config/index.js";
export type {
  LoadResult,
  LoadSuccess,
  LoadFailure,
  ValidationError,
  ValidationResult,
  Config,
  EnginesConfig,
  EngineConfig,
  BoundaryTag,
  BoundaryCrossing,
  BoundariesConfig,
  ScoringConfig,
  CIConfig,
  CIFailOn,
  ReportConfig,
  FileSetConfig,
  Glob,
  PathPattern,
} from "./config/index.js";
