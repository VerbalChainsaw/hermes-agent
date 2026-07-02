#!/usr/bin/env node
/**
 * center-geo CLI entrypoint.
 *
 * Current surface:
 *   - `index`: partial implementation; validates config, enumerates files,
 *     and reports deterministic enumeration details, but graph emission is
 *     still intentionally unfinished.
 *   - `scan`: live end-to-end pipeline (enumerate -> parse -> build graph ->
 *     run engines -> fuse -> report).
 *   - `diff`: compares two report.json files and emits machine-parseable JSON.
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

import {
  ExitCode,
  PACKAGE_VERSION,
  type ExitCodeValue,
} from "../index.js";
import { loadConfig } from "../config/load.js";
import { enumerateFiles } from "../enumerate/enumerate.js";
import { GraphStore } from "../graph/store.js";
import { SEVERITY_RANK } from "../engines/radial/index.js";
import { formatHuman, formatJson } from "../output/format.js";
import {
  writeJsonReport,
  writeMarkdownReport,
  writeSarifReport,
} from "../reports/index.js";
import { buildEngineRuns, buildScanFrame, type CoverageReport } from "../reports/model.js";
import { runScanPipeline, ScanError } from "../scan/index.js";
import {
  diffReports,
  readReport,
  diffExitCode,
  InvalidSeverityError,
} from "../diff/index.js";

// Tool name — single source of truth. Mirrors the bin field in package.json
// and the exports map key.
const TOOL_NAME = "center-geo";

/**
 * Shared options for repo-backed commands. We keep the shape narrow on
 * purpose so `index`/`scan` can diverge cleanly if their option surfaces
 * need to split further.
 */
interface RepoCommandOptions {
  config?: string;
  output?: string;
  outputDir?: string;
  ci?: boolean;
  format?: "human" | "json";
}

/**
 * Register a repo-backed command with shared config / output / format
 * plumbing. Some commands are fully shipped (`scan`), some are partial
 * (`index`), but the wrapper itself is not a stub.
 */
function registerRepoCommand(
  program: Command,
  spec: {
    name: string;
    description: string;
    ticketRange: string;
    options?: {
      config?: boolean;
      output?: "file" | "dir";
      ci?: boolean;
      format?: boolean;
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
  if (spec.options?.format) {
    cmd.option(
      "-f, --format <fmt>",
      "Output format: 'human' (default, stderr) or 'json' (stdout)",
      (value: string) => {
        if (value !== "human" && value !== "json") {
          throw new Error(`Invalid format '${value}' (expected 'human' or 'json')`);
        }
        return value;
      },
      "human",
    );
  }

  cmd.action(async (repo: string, options: RepoCommandOptions) => {
    try {
      // Load + validate config before command-specific work so every
      // repo-backed command shares the same FR10 config-error path.
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
    // For 'index', actually run the enumerator (T02) so we exercise the
    // end-to-end path: load config → enumerate files → classify → report.
    // For 'scan', the full pipeline runs through the radial engine (T09):
    // enumerate → parse → build graph → run engines → emit signals.
    if (spec.name === "index") {
      const result = await enumerateFiles(repo, cfg.config);
      if (!result.ok) {
        console.error(`${TOOL_NAME} index: ${result.message}`);
        process.exit(ExitCode.REPO_READ_ERROR);
      }
      console.error(
        `${TOOL_NAME} index: enumerated ${result.files.length} files ` +
          `in ${result.durationMs.toFixed(0)}ms ` +
          `(source=${result.counts.source}, test=${result.counts.test}, ` +
          `generated=${result.counts.generated}, warnings=${result.warnings.length})`,
      );
      if (result.warnings.length > 0) {
        for (const w of result.warnings.slice(0, 5)) {
          console.error(`  warn ${w.path}: ${w.message}`);
        }
      }
      // Stub: real graph emission is T03+. Surface the hash so users can
      // verify determinism across runs.
      console.error(`${TOOL_NAME} index: enumeration hash=${result.hash}. Not yet implemented as a graph emit (planned for T03+).`);
      process.exit(ExitCode.INTERNAL);
    }
    // scan (T09+): run the full pipeline via runScanPipeline().
    // DeepSeek Important #2: the pipeline was extracted to
    // src/scan/pipeline.ts so this CLI is a thin orchestrator.
    {
      const result = await runScanPipeline({
        repo,
        config: cfg.config,
        deterministicGraphId: true, // DeepSeek Important #3
      });

      // Reconstruct the GraphSnapshot from the pipeline result so the
      // existing T15/T17-T19 output code can stay unchanged.
      const allNodes = result.nodes;
      const allEdges = result.edges;
      const signals = result.signals;
      const fused = result.fused;
      const parseWarnings = result.parseWarnings;
      // Reuse the pipeline's snapshot (which has the canonical
      // coverage: files_seen = every enumerated file, not just the
      // successfully-parsed ones). The CLI overrides fields that
      // depend on the CLI's run (tool_version, graph_id) and adds
      // warnings.
      const pipelineSnapshot = result.store.snapshot;
      const snapshot: import("../graph/index.js").GraphSnapshot = {
        ...pipelineSnapshot,
        schema_version: "1.0.0",
        tool_version: PACKAGE_VERSION,
        graph_id: result.graphId,
        root: repo,
        warnings: parseWarnings.map((w) => ({
          code: w.code,
          message: w.message,
          path: w.file,
          severity: "warning" as const,
        })),
      };
      // Construct the graph store from the snapshot (T03). Used by
      // the report writers to navigate the graph; not used by the
      // CLI handler itself.
      void new GraphStore(snapshot);
      const fileNodeSeeds = allNodes.filter((n) => n.kind === "file").map((n) => n.id);
      const topN = cfg.config.report.top_n_hypotheses;
      const top = fused.slice(0, topN);
      const coverage = snapshot.coverage as CoverageReport;
      const reportMeta = {
        toolVersion: PACKAGE_VERSION,
        scanFrame: buildScanFrame(snapshot),
        engineRuns: buildEngineRuns(cfg.config, signals),
        signals,
        warnings: snapshot.warnings,
      };

      // Format dispatch (T15).
      const fmt: "human" | "json" =
        options.format === "json" ? "json" : "human";

      if (fmt === "json") {
        const out = formatJson(fused, topN, signals.length, coverage, reportMeta);
        process.stdout.write(out);
      } else {
        // Human mode: print a 1-line summary + the top-N body.
        process.stderr.write(
          `${TOOL_NAME} scan: ${allNodes.length} nodes, ${allEdges.length} edges, ` +
            `${signals.length} signals fused into ${fused.length} hypotheses ` +
            `(${fileNodeSeeds.length} files, ${parseWarnings.length} parse warnings, ` +
            `parse=${result.parseMs}ms engines=${result.engineMs}ms)\n`,
        );
        const out = formatHuman(fused, topN);
        process.stderr.write(out);
      }

      // T17-T19: write JSON, Markdown, and SARIF reports to --output-dir.
      if (options.outputDir) {
        const dir = options.outputDir;
        await Promise.all([
          writeJsonReport(fused, topN, signals.length, `${dir}/report.json`, coverage, reportMeta),
          writeMarkdownReport(fused, topN, signals.length, PACKAGE_VERSION, `${dir}/report.md`, {
            ...reportMeta,
            coverage,
          }),
          writeSarifReport(fused, topN, TOOL_NAME, PACKAGE_VERSION, `${dir}/report.sarif`),
        ]);
        process.stderr.write(`${TOOL_NAME} scan: wrote reports to ${dir}/report.{json,md,sarif}\n`);
      }

      // Exit code: 1 (threshold) if any top hypothesis has severity >= high.
      const highSeverity = top.some((h) =>
        SEVERITY_RANK[h.maxSeverity] >= SEVERITY_RANK.high,
      );
      process.exit(highSeverity ? ExitCode.THRESHOLD : ExitCode.OK);
    }
    } catch (err) {
      // Map pipeline errors to FR10 exit codes. The pipeline throws
      // ScanError for enumeration failures (path doesn't exist, no
      // files matched, etc.); for these we exit REPO_READ_ERROR=4,
      // not the uncaught-exception default of INTERNAL=5.
      if (err instanceof ScanError && err.code === "enumeration_failed") {
        console.error(err.message);
        process.exit(ExitCode.REPO_READ_ERROR);
      }
      // Diff subcommand's InvalidSeverityError is handled INSIDE the
      // diff action (it has its own catch). The diff action is a
      // separate command, so we never reach here for diff errors.
      // Anything else is INTERNAL=5.
      console.error(`${TOOL_NAME} ${spec.name}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(ExitCode.INTERNAL);
    }
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

  registerRepoCommand(program, {
    name: "index",
    description: "Index a repository into a graph snapshot (T02+).",
    ticketRange: "T02+",
    options: { config: true, output: "file" },
  });

  registerRepoCommand(program, {
    name: "scan",
    description: "Run a full scan (index + geometries + fusion + report) (T09+).",
    ticketRange: "T09+",
    options: { config: true, output: "dir", ci: true, format: true },
  });

  // T24: diff subcommand. Compares two report.json files and emits
  // a JSON diff to stdout. Useful for CI: compare the current scan
  // to the baseline and report new/resolved/changed hypotheses.
  program
    .command("diff")
    .description("Compare two report.json files and emit a JSON diff (T24).")
    .argument("<base>", "Path to the base report.json (e.g. main branch).")
    .argument("<head>", "Path to the head report.json (e.g. PR branch).")
    .action(async (base: string, head: string) => {
      const [baseReport, headReport] = await Promise.all([
        readReport(base),
        readReport(head),
      ]);
      const d = diffReports(baseReport, headReport, base, head);
      process.stdout.write(JSON.stringify(d, null, 2) + "\n");
      // Exit-code logic is centralized in diffExitCode() (see
      // src/diff/compare.ts). The CLI just maps the boolean decision
      // to FR10 exit codes. Centralizing the rule in the diff module
      // means future T25+ extensions (e.g. --fail-on-resolved) can
      // add rules there without touching the CLI.
      //
      // DeepSeek Critical #3: a future-version report.json with an
      // unknown severity (e.g. "blocker") makes the regression check
      // unreliable. We catch the validation error here and surface it
      // as INTERNAL=5 so CI gates fail loud, not silent.
      try {
        const decision = diffExitCode(d);
        // Keep stdout machine-parseable JSON only. The human-readable
        // decision line goes to stderr so CI / scripts can `JSON.parse`
        // stdout without stripping trailers.
        process.stderr.write(
          `# decision: ${decision.regression ? "regression" : "ok"} — ${decision.reason}\n`,
        );
        process.exit(decision.regression ? ExitCode.THRESHOLD : ExitCode.OK);
      } catch (err) {
        if (err instanceof InvalidSeverityError) {
          process.stderr.write(`center-geo diff: ${err.message}\n`);
          process.exit(ExitCode.INTERNAL);
        }
        throw err;
      }

    });


  // `program.parse(argv)` (synchronous variant). Async action handlers
    // in T05-T09 call process.exit() directly; that propagates to the
    // shell exit code even when the parent process exits before the
    // handler completes (which is fine for spawned-process scenarios
    // because spawnSync / shell wait for the actual exit code).
    //
    // For commander parse errors (--nope, missing arg, etc.) we use
    // exitOverride() so commander throws CommanderError instead of
    // calling process.exit — that lets us map errors to spec exit codes.
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
      // Unknown error (TypeError, etc.) — treat as internal.
      return ExitCode.INTERNAL;
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
