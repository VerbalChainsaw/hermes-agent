/**
 * Re-export the canonical ExitCode from the package root so tests
 * assert the spec's exit codes by name instead of magic numbers.
 */
export { ExitCode, type ExitCodeValue } from "../src/index.js";
