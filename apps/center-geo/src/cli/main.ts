#!/usr/bin/env node
/**
 * center-geo CLI entrypoint.
 *
 * Status (T00): handles --help and --version only. Real subcommands
 * (index, scan, config) land in later tickets — see
 * docs/08-implementation-tickets.md in the requirements package.
 *
 * Design rules from docs/01-product-requirements.md (NFR5, FR10, FR11):
 *   - Deterministic output in CI mode (no timestamps in report bodies).
 *   - Stable exit codes: 0 ok, 1 threshold, 2 extraction gap, 3 config,
 *     4 repo read, 5 internal.
 *   - No code execution required for graph extraction.
 *   - No secret exposure in report excerpts.
 */

import { Command, CommanderError } from "commander";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExitCode, PACKAGE_VERSION, type ExitCodeValue } from "../index.js";
import { loadConfig } from "../config/load.js";

// Tool name — single source of truth. Mirrors the bin field in package.json
// and the exports map key.
const TOOL_NAME = "center-geo";

/**
 * Options accepted by a stub subcommand. Kept narrow on purpose — when
 * T02+ replaces the stub body with a real implementation, this type
 * narrows accordingly (e.g. `IndexOptions`, `ScanOptions`).
 */
interface StubOptions {
  config?: string;
  output?: string;
  ci?: boolean;
}

/**
 * Register a placeholder subcommand. Centralises the "not yet
 * implemented" body so that adding 28 more stubs across T01–T30 is a
 * one-liner each instead of copy-paste.
 */
function stubSubcommand(
  program: Command,
  spec: {
    name: string;
    description: string;
    ticketRange: string;
    options?: {
      config?: boolean;
      output?: "file" | "dir";
      ci?: boolean;
    };
  },
): void {
  const cmd = program
    .command(spec.name)
    .description(spec.description)
    .argument("<repo>", "Path to the repository root to " + spec.name + ".");

  if (spec.options?.config !== false) {
    cmd.option("-c, --config <path>", "Path to config file.");
  }
  if (spec.options?.output === "file") {
    cmd.option("-o, --output <path>", "Output graph snapshot path.");
  } else if (spec.options?.output === "dir") {
    // Use --output-dir as the long form AND as the short flag to avoid
    // collision with `index`'s --output (single file vs directory). The
    // `-d` short form is unambiguous.
    cmd.option("-d, --output-dir <path>", "Directory for report outputs.");
  }
  if (spec.options?.ci) {
    cmd.option("--ci", "CI mode: deterministic output, threshold-based exit codes.");
  }

  cmd.action(async (repo: string, options: StubOptions) => {
    // Load + validate config BEFORE claiming "not yet implemented".
    // T01 acceptance: invalid config returns ExitCode.CONFIG_ERROR=3.
    const cfg = await loadConfig(options.config);
    if (!cfg.ok) {
      console.error(`${TOOL_NAME} ${spec.name}: ${cfg.message}`);
      if (cfg.code === "validation_error" && Array.isArray(cfg.details)) {
        for (const err of cfg.details as { path: string; message: string }[]) {
          console.error(`  - ${err.path || "(root)"}: ${err.message}`);
        }
      }
      process.exit(ExitCode.CONFIG_ERROR);
    }
    // Config OK — the subcommand body itself isn't implemented yet, but
    // we proved the loader works end-to-end and the exit-code-3 path is
    // reachable from the CLI. The next ticket (T02+ for this subcommand)
    // will replace this stub with real indexing/scanning work; for now,
    // surface what we have so the user knows their config was honored.
    console.error(
      `${TOOL_NAME} ${spec.name}: config OK (${cfg.source}, hash=${cfg.hash}). ` +
        `Stub exit: not yet implemented (planned for ${spec.ticketRange}). ` +
        `Target repo: ${repo}`,
    );
    process.exit(ExitCode.INTERNAL);
  });
}

/**
 * Map commander parse-time errors to spec exit codes (FR10). Without
 * this, every malformed invocation exits 1 ("threshold exceeded"),
 * making CI gates unable to distinguish a real threshold breach from
 * a typo'd subcommand name.
 *
 * Commander 12.1.0 quirk: when subcommands are registered, `--help`
 * invokes the help-after-error code path (line 1825-1827 of command.js),
 * which sets exitCode=1 even though the user explicitly asked for help.
 * We special-case this by checking err.exitCode first; when commander
 * sets exitCode=0 we trust it (covers --version and pre-error --help).
 * For exitCode=1 with a help code, we treat it as OK because the user
 * requested help; CLI gates that distinguish "asked for help" from
 * "real error" can inspect the commander code string instead.
 *
 * Commander error.code values:
 *   - commander.version              -> --version flag; exit 0
 *   - commander.help                  -> --help flag; exit 0 (override 1)
 *   - commander.helpDisplayed         -> help([command]); exit 0
 *   - commander.missingArgument       -> required positional missing
 *   - commander.unknownOption         -> unknown flag
 *   - commander.invalidArgument       -> flag value failed validation
 *   - commander.excessArguments       -> too many positional args
 *   - commander.missingMandatoryOptionValue
 *   - commander.optionMissingArgument -> option missing its value
 *   - commander.unknownCommand        -> typo'd subcommand name; INTERNAL
 *   - anything else                   -> INTERNAL (defensive)
 */
function mapCommanderError(err: CommanderError): ExitCodeValue {
  // User asked for help explicitly (or help-after-error) — exit 0.
  if (
    err.code === "commander.version" ||
    err.code === "commander.help" ||
    err.code === "commander.helpDisplayed"
  ) {
    return ExitCode.OK;
  }
  // Bad CLI input — CONFIG_ERROR per FR10.
  if (
    err.code === "commander.missingArgument" ||
    err.code === "commander.unknownOption" ||
    err.code === "commander.invalidArgument" ||
    err.code === "commander.excessArguments" ||
    err.code === "commander.missingMandatoryOptionValue" ||
    err.code === "commander.optionMissingArgument"
  ) {
    return ExitCode.CONFIG_ERROR;
  }
  // Typos, unknown subcommands, anything we didn't classify — INTERNAL.
  return ExitCode.INTERNAL;
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();

  program
    .name(TOOL_NAME)
    .description(
      "CENTER-MULTIGEOMETRY: deterministic multi-geometry structural " +
        "risk scanner. Companion to center-audit. Emits hypotheses, " +
        "never confirmed defects.",
    )
    .version(PACKAGE_VERSION);

  // Per FR10: don't let commander default to exit 1 for parse errors.
  // exitOverride() makes commander throw CommanderError instead of
  // calling process.exit, so we can map to spec exit codes below.
  program.exitOverride();

  stubSubcommand(program, {
    name: "index",
    description: "Index a repository into a graph snapshot (T02+).",
    ticketRange: "T02+",
    options: { config: true, output: "file" },
  });

  stubSubcommand(program, {
    name: "scan",
    description: "Run a full scan (index + geometries + fusion + report) (T09+).",
    ticketRange: "T09+",
    options: { config: true, output: "dir", ci: true },
  });

  try {
    program.parse(argv);
    return ExitCode.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      const code = mapCommanderError(err);
      // commander already wrote the error message to stderr; nothing to
      // add except the exit code mapping.
      return code;
    }
    throw err;
  }
}

// Global safety net: an uncaught exception or unhandled rejection
// otherwise defaults to exit 1, which conflicts with FR10 (1 = threshold
// exceeded). Route to INTERNAL=5 so CI gates can tell crashes from
// threshold breaches. Async handlers (T09+) will rely on this.
process.on("uncaughtException", (err) => {
  console.error(`${TOOL_NAME}: uncaught exception: ${err.stack ?? err.message ?? err}`);
  process.exit(ExitCode.INTERNAL);
});
process.on("unhandledRejection", (reason) => {
  console.error(`${TOOL_NAME}: unhandled rejection: ${String(reason)}`);
  process.exit(ExitCode.INTERNAL);
});

// Detect direct invocation by resolving symlinks/8.3-short names and
// comparing real paths. Without this, junction points and Windows
// 8.3 short-name paths cause silent fall-through (the module loads
// but main() never runs). See test/cli.test.ts "direct invocation"
// for coverage.
const isDirectInvocation = (() => {
  if (!process.argv[1]) return false;
  try {
    const invokedReal = realpathSync(process.argv[1]);
    const selfReal = realpathSync(fileURLToPath(import.meta.url));
    return invokedReal === selfReal;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  const code = main();
  if (code !== ExitCode.OK) process.exit(code);
}
