/**
 * Scan pipeline public surface.
 *
 * The compute side of `center-geo scan` lives here, separate from
 * the CLI (src/cli/main.ts). The CLI is responsible for option
 * parsing, output formatting, and exit codes; the pipeline is the
 * pure-data side.
 */

export {
  runScanPipeline,
  ScanError,
} from "./pipeline.js";
export type {
  RunScanInputs,
  RunScanResult,
  ParseWarning,
} from "./pipeline.js";
