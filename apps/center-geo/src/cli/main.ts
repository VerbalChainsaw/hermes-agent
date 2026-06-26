#!/usr/bin/env node
/**
 * center-geo CLI entrypoint.
 *
 * Status (T00): handles --help and --version only. Real subcommands
 * (index, scan, config) land in later tickets:
 *   - T01: config loader + validator
 *   - T02+: index / scan subcommands
 *
 * Design rules from docs/01-product-requirements.md (NFR5, FR10, FR11):
 *   - Deterministic output in CI mode (no timestamps in report bodies).
 *   - Stable exit codes: 0 ok, 1 threshold, 2 extraction gap, 3 config,
 *     4 repo read, 5 internal.
 *   - No code execution required for graph extraction.
 *   - No secret exposure in report excerpts.
 */

import { Command } from "commander";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../index.js";

const EXIT_OK = 0;
const EXIT_THRESHOLD = 1;
const EXIT_EXTRACTION_GAP = 2;
const EXIT_CONFIG_ERROR = 3;
const EXIT_REPO_READ_ERROR = 4;
const EXIT_INTERNAL = 5;

export const ExitCode = {
  OK: EXIT_OK,
  THRESHOLD: EXIT_THRESHOLD,
  EXTRACTION_GAP: EXIT_EXTRACTION_GAP,
  CONFIG_ERROR: EXIT_CONFIG_ERROR,
  REPO_READ_ERROR: EXIT_REPO_READ_ERROR,
  INTERNAL: EXIT_INTERNAL,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

function buildProgram(): Command {
  const program = new Command();

  program
    .name("center-geo")
    .description(
      "CENTER-MULTIGEOMETRY: deterministic multi-geometry structural " +
        "risk scanner. Companion to center-audit. Emits hypotheses, " +
        "never confirmed defects.",
    )
    .version(PACKAGE_VERSION);

  // Stub subcommands. Each is a no-op until its ticket lands.
  // We register them so `center-geo <sub> --help` works today and the
  // CLI surface stays stable while we build.
  program
    .command("index")
    .description("Index a repository into a graph snapshot (T02+).")
    .argument("<repo>", "Path to the repository root to index.")
    .option("-c, --config <path>", "Path to config file.")
    .option("-o, --output <path>", "Output graph snapshot path.")
    .action(() => {
      console.error(
        "center-geo index: not yet implemented (planned for T02+).",
      );
      process.exit(ExitCode.INTERNAL);
    });

  program
    .command("scan")
    .description(
      "Run a full scan (index + geometries + fusion + report) (T09+).",
    )
    .argument("<repo>", "Path to the repository root to scan.")
    .option("-c, --config <path>", "Path to config file.")
    .option("-o, --output-dir <path>", "Directory for report outputs.")
    .option("--ci", "CI mode: deterministic output, threshold-based exit codes.")
    .action(() => {
      console.error(
        "center-geo scan: not yet implemented (planned for T09+).",
      );
      process.exit(ExitCode.INTERNAL);
    });

  return program;
}

export function main(argv: string[] = process.argv): number {
  const program = buildProgram();
  // Commander parses synchronously and writes help to stdout.
  // parseAsync returns a Promise but we don't need to await — exit happens
  // via process.exit in handlers, or commander exits 0 after parse for
  // --help/--version.
  program.parse(argv);
  return ExitCode.OK;
}

// Run when invoked directly (not when imported by tests).
// Detect via import.meta.url vs process.argv[1].
const isDirectInvocation = (() => {
  if (!process.argv[1]) return false;
  try {
    const invoked = new URL(`file://${process.argv[1]}`).href;
    const self = import.meta.url;
    return invoked === self;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  const code = main();
  // main() returns 0 on normal parse; subcommand handlers call process.exit
  // directly. This guards against future code paths that fall through.
  if (code !== ExitCode.OK) process.exit(code);
}

// Suppress unused-export warnings for symbols only consumed by future tickets.
export { PACKAGE_NAME as _PACKAGE_NAME };
