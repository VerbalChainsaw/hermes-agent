/**
 * Enumerate module — public surface.
 *
 * T03+ (graph builder) consumes EnumerationOutcome; T24 (graph diff)
 * uses the per-file contentHash to detect changes between scans.
 */

export { enumerateFiles } from "./enumerate.js";
export { buildMatcher, matchesAny, toPosixPath } from "./glob.js";
export {
  activeTestGlobs,
  activeGeneratedGlobs,
  classify,
  classifyPath,
} from "./classifier.js";
export type {
  ContentHash,
  EnumerationFailure,
  EnumerationOutcome,
  EnumerationResult,
  EnumerationWarning,
  FileClassification,
  FileEntry,
} from "./types.js";
