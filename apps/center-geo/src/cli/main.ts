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
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExitCode, PACKAGE_VERSION, type ExitCodeValue } from "../index.js";
import { loadConfig } from "../config/load.js";
import { enumerateFiles } from "../enumerate/index.js";
import { parseFile } from "../adapters/ts/index.js";
import { GraphStore } from "../graph/index.js";
import { runRadialEngine, SEVERITY_RANK } from "../engines/radial/index.js";
import { runCycleEngine } from "../engines/cycle/index.js";
import { runBoundaryEngine } from "../engines/boundary/index.js";
import { runAnomalyEngine } from "../engines/anomaly/index.js";
import { runConvergentEngine } from "../engines/convergent/index.js";
import { fuseSignals } from "../scoring/fuse.js";
import { formatHuman, formatJson } from "../output/format.js";
import { writeJsonReport, writeMarkdownReport, writeSarifReport } from "../reports/index.js";

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
  outputDir?: string;
  ci?: boolean;
  format?: "human" | "json";
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
    // scan stub (T09+).
    {
      // 1. Enumerate files.
      const enumResult = await enumerateFiles(repo, cfg.config);
      if (!enumResult.ok) {
        console.error(`${TOOL_NAME} scan: ${enumResult.message}`);
        process.exit(ExitCode.REPO_READ_ERROR);
      }

      // 2. Parse each source file via the TS adapter (T05-T07).
      const allNodes: import("../graph/index.js").GraphNode[] = [];
      const allEdges: import("../graph/index.js").GraphEdge[] = [];
      const parseWarnings: { file: string; code: string; message: string }[] = [];
      for (const f of enumResult.files) {
        if (f.classification !== "source") continue; // skip tests + generated in T09
        const content = await readFile(f.absolutePath, "utf-8");
        const parseResult = parseFile(f.relativePath, content);
        if (parseResult.ok) {
          allNodes.push(parseResult.fileNode, ...parseResult.nodes);
          allEdges.push(...parseResult.edges);
        } else {
          parseWarnings.push({
            file: f.relativePath,
            code: parseResult.code,
            message: parseResult.message,
          });
        }
      }

      // 3. Build a graph snapshot + store.
      const snapshot: import("../graph/index.js").GraphSnapshot = {
        schema_version: "1.0.0",
        tool_version: PACKAGE_VERSION,
        graph_id: `scan:${repo}:${cfg.hash}`,
        root: repo,
        coverage: {
          files_seen: enumResult.files.length,
          files_parsed: allNodes.length > 0 ? (allNodes.length - parseWarnings.length) : 0,
          files_failed: parseWarnings.length,
          edges_low_confidence: allEdges.filter((e) => e.confidence === "low" || e.confidence === "unknown").length,
          parse_ms: 0,
          graph_build_ms: 0,
        },
        nodes: allNodes,
        edges: allEdges,
        warnings: parseWarnings.map((w) => ({
          code: w.code,
          message: w.message,
          path: w.file,
          severity: "warning" as const,
        })),
      };
      const store = new GraphStore(snapshot);

      // 4. Run all 5 engines: radial (T09), cycle (T10), boundary (T11),
      // anomaly (T12), convergent (T13). All are pure / read-only /
      // deterministic. Future fusion (T15) and reports (T17-T19) will
      // consume the combined signal set.
      const fileNodeSeeds = allNodes
        .filter((n) => n.kind === "file")
        .map((n) => n.id);
      const boundaryTagNames = Object.keys(cfg.config.boundaries?.tags ?? {});
      const radialSignals = runRadialEngine(
        store,
        cfg.config.engines.radial,
        fileNodeSeeds,
        boundaryTagNames,
      );
      const cycleSignals = runCycleEngine(store, cfg.config.engines.cycle);
      const boundarySignals = cfg.config.boundaries
        ? runBoundaryEngine(store, cfg.config.boundaries, {
            allowedEdgeKinds: cfg.config.engines.cycle.allowed_edge_kinds,
          })
        : [];
      const anomalySignals = runAnomalyEngine(store, cfg.config.engines.anomaly, {
        allowedEdgeKinds: cfg.config.engines.cycle.allowed_edge_kinds,
      });
      const convergentSignals = runConvergentEngine(
        store,
        cfg.config.engines.convergent,
        { allowedEdgeKinds: cfg.config.engines.cycle.allowed_edge_kinds },
      );
      const signals = [
        ...radialSignals,
        ...cycleSignals,
        ...boundarySignals,
        ...anomalySignals,
        ...convergentSignals,
      ];

      // 5. Fuse + rank + report. T14 (scoring/fusion) collapses the 5
      // engine outputs into per-target FusedScore[]. T15 picks the top
      // config.report.top_n_hypotheses (default 20) and emits them.
      const fused = fuseSignals(signals, cfg.config.scoring);
      const topN = cfg.config.report.top_n_hypotheses;
      const top = fused.slice(0, topN);

      // Format dispatch (T15).
      // - 'human' (default): stderr summary + body, exit code based on severity.
      // - 'json': stdout JSON, stderr status, exit code based on severity.
      const fmt: "human" | "json" =
        options.format === "json" ? "json" : "human";

      if (fmt === "json") {
        const out = formatJson(fused, topN, signals.length);
        process.stdout.write(out);
      } else {
        // Human mode: print a 1-line summary + the top-N body.
        process.stderr.write(
          `${TOOL_NAME} scan: ${allNodes.length} nodes, ${allEdges.length} edges, ` +
            `${signals.length} signals fused into ${fused.length} hypotheses ` +
            `(${enumResult.files.length} files, ${parseWarnings.length} parse warnings)\n`,
        );
        const out = formatHuman(fused, topN);
        process.stderr.write(out);
      }

      // T17-T19: write JSON, Markdown, and SARIF reports to --output-dir
      // if specified. T17 emits the same shape as the stdout JSON; T18
      // emits a human-readable markdown table; T19 emits SARIF 2.1.0
      // for GitHub code-scanning integration.
      if (options.outputDir) {
        const dir = options.outputDir;
        await Promise.all([
          writeJsonReport(fused, topN, signals.length, `${dir}/report.json`),
          writeMarkdownReport(fused, topN, signals.length, PACKAGE_VERSION, `${dir}/report.md`),
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
    options: { config: true, output: "dir", ci: true, format: true },
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
