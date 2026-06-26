/**
 * File classification logic.
 *
 * Three classifications on top of the user's include/exclude match:
 *   1. "test"     — matches a pattern from config.tests.globs (or the
 *                    default test globs if config.tests is unset).
 *   2. "generated" — matches a pattern from config.generated.globs
 *                    (or the default generated globs).
 *   3. "source"   — neither of the above; regular project source.
 *
 * Tests always win over generated when a file matches both (test files
 * get their own handling downstream, including the test_gap_bonus).
 */
import { matchesAny, toPosixPath } from "./glob.js";
import type { Config } from "../config/types.js";
import type { FileClassification } from "./types.js";

const DEFAULT_TEST_GLOBS = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.test.tsx",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/*.test.js",
  "**/*.spec.js",
  "**/*.test.mjs",
  "**/*.spec.mjs",
];

const DEFAULT_GENERATED_GLOBS = [
  "**/*.generated.ts",
  "**/*.generated.tsx",
  "**/*.generated.js",
  "**/__generated__/**",
  "**/dist/**",
  "**/build/**",
];

/**
 * Resolve the active test-glob set: user-provided if any, otherwise the
 * defaults. Returning a new array each call keeps callers from mutating
 * the config in place.
 */
export function activeTestGlobs(config: Config): string[] {
  return config.tests?.globs ?? DEFAULT_TEST_GLOBS;
}

/**
 * Same as activeTestGlobs but for generated-file detection.
 */
export function activeGeneratedGlobs(config: Config): string[] {
  return config.generated?.globs ?? DEFAULT_GENERATED_GLOBS;
}

/**
 * Classify a single file by matching its repo-relative POSIX path
 * against the config's test and generated globs. Order of checks
 * matters: test wins over generated.
 */
export function classify(relativePosix: string, config: Config): FileClassification {
  if (matchesAny(relativePosix, activeTestGlobs(config))) return "test";
  if (matchesAny(relativePosix, activeGeneratedGlobs(config))) return "generated";
  return "source";
}

/**
 * Convenience wrapper that normalizes the input path then classifies.
 */
export function classifyPath(inputPath: string, config: Config): FileClassification {
  return classify(toPosixPath(inputPath), config);
}
