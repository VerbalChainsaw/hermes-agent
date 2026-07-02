import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { ExitCode } from "./exit-codes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

/**
 * Locate the built CLI entrypoint. We test the BUILT artifact, not the
 * source via tsx, because:
 *
 *  1. It mirrors what users actually run (`center-geo` -> dist/cli/main.js).
 *  2. It avoids platform-specific shim resolution issues (.bin/tsx.cmd vs
 *     .bin/tsx on Windows).
 *  3. tsc -b is fast (~200ms), so the build step is cheap to keep fresh.
 *
 * If dist/ doesn't exist yet, fail loudly — T00's setup step includes
 * `npm run build`, and the smoke test enforces that the build is in place.
 */
function locateBuiltCli(): string {
  const distEntry = join(repoRoot, "dist", "cli", "main.js");
  if (!existsSync(distEntry)) {
    throw new Error(
      `Built CLI not found at ${distEntry}. Run \`npm run build\` before tests.`,
    );
  }
  return distEntry;
}

function runCli(args: string[]) {
  const cliPath = locateBuiltCli();
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 15_000,
  });
  // Surface a clear error if the build artifact vanished between the
  // existsSync check above and the spawn (TOCTOU). Without this, vitest
  // would surface a confusing "spawnSync ENOENT" mid-test.
  if (r.error && "code" in r.error && r.error.code === "ENOENT") {
    throw new Error(
      `Built CLI vanished mid-test at ${cliPath}. Re-run \`npm run build\`.`,
    );
  }
  return r;
}

describe("center-geo CLI (T00 smoke)", () => {
  it("--version exits 0 and prints the version", () => {
    const r = runCli(["--version"]);
    expect(r.status).toBe(ExitCode.OK);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help exits 0 and includes the tool name and description", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(ExitCode.OK);
    expect(r.stdout).toMatch(/center-geo/);
    expect(r.stdout).toMatch(/CENTER-MULTIGEOMETRY/);
    expect(r.stdout).toMatch(/multi-geometry/i);
  });

  it("index subcommand --help exits 0 and is documented", () => {
    const r = runCli(["index", "--help"]);
    expect(r.status).toBe(ExitCode.OK);
    expect(r.stdout).toMatch(/Index a repository/i);
    expect(r.stdout).toMatch(/--config/);
    expect(r.stdout).toMatch(/--output/);
  });

  it("scan subcommand --help exits 0 and is documented", () => {
    const r = runCli(["scan", "--help"]);
    expect(r.status).toBe(ExitCode.OK);
    expect(r.stdout).toMatch(/Run a full scan/i);
    expect(r.stdout).toMatch(/--ci/);
    // scan uses -d, --output-dir to avoid collision with index's --output
    expect(r.stdout).toMatch(/--output-dir/);
  });

  it("index without args exits with CONFIG_ERROR (FR10 exit code 3)", () => {
    // FR10: bad CLI input is CONFIG_ERROR, not the spec's "threshold exceeded".
    const r = runCli(["index"]);
    expect(r.status).toBe(ExitCode.CONFIG_ERROR);
  });

  it("index currently exits with INTERNAL after deterministic enumeration", () => {
    // Index is intentionally partial on this branch: it validates config,
    // enumerates the repo, emits deterministic counts/hash, then exits 5
    // until graph emission lands.
    const r = runCli(["index", repoRoot]);
    expect(r.status).toBe(ExitCode.INTERNAL);
    expect(r.stderr).toMatch(/Not yet implemented as a graph emit|Stub exit/i);
  });

  it("scan on a missing repo exits with REPO_READ_ERROR code 4", () => {
    const r = runCli(["scan", "/definitely/not/a/path"]);
    expect(r.status).toBe(ExitCode.REPO_READ_ERROR);
  });

  it("scan on a real package runs the full pipeline and emits a valid JSON report contract", () => {
    // Current behavior: scan runs end-to-end (enumerate -> parse -> build
    // graph -> run engines -> fuse -> report) and returns either OK=0 or
    // THRESHOLD=1 depending on surfaced hypothesis severity.
    const r = runCli(["scan", "--format", "json", repoRoot]);
    expect([ExitCode.OK, ExitCode.THRESHOLD]).toContain(r.status);
    const report = JSON.parse(r.stdout) as {
      schema_version: string;
      tool_version: string;
      scan_frame: { root: string; config_hash: string; revision?: { vcs?: string } };
      coverage: {
        files_seen: number;
        files_indexed: number;
        files_failed: number;
        files_parsed: number;
      };
      engine_runs: Array<{ geometry_id: string; status: string; signal_count?: number }>;
      hypotheses: Array<{ id: string; score: { severity: string }; investigation_packet: object }>;
      signals: unknown[];
      warnings: unknown[];
      count: number;
      raw_signal_count: number;
    };
    expect(report.schema_version).toBe("1.0.0");
    expect(typeof report.tool_version).toBe("string");
    expect(report.scan_frame.root).toBe(repoRoot);
    expect(typeof report.scan_frame.config_hash).toBe("string");
    expect(report.scan_frame.config_hash.length).toBeGreaterThan(0);
    expect(report.coverage.files_seen).toBeGreaterThan(0);
    expect(report.coverage.files_indexed).toBeGreaterThan(0);
    expect(report.coverage.files_parsed).toBeGreaterThan(0);
    expect(report.coverage.files_failed).toBeGreaterThanOrEqual(0);
    expect(report.engine_runs.map((run) => run.geometry_id).sort()).toEqual([
      "anomaly",
      "boundary",
      "convergent",
      "cycle",
      "path",
      "radial",
    ]);
    expect(report.engine_runs.every((run) => run.status === "completed")).toBe(true);
    expect(report.signals.length).toBeGreaterThan(0);
    expect(report.count).toBe(report.hypotheses.length);
    expect(report.raw_signal_count).toBeGreaterThanOrEqual(report.signals.length);
    expect(report.hypotheses[0]).toMatchObject({
      id: expect.any(String),
      score: { severity: expect.any(String) },
      investigation_packet: expect.any(Object),
    });
    expect(Array.isArray(report.warnings)).toBe(true);
  });

  it("unknown subcommand exits with INTERNAL code 5 (not THRESHOLD)", () => {
    // FR10: an unknown subcommand is an internal state issue (we don't
    // know what the user wanted), not a "threshold exceeded" claim.
    const r = runCli(["bogus-subcommand"]);
    expect(r.status).toBe(ExitCode.INTERNAL);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  it("unknown flag exits with CONFIG_ERROR code 3", () => {
    const r = runCli(["--nope"]);
    expect(r.status).toBe(ExitCode.CONFIG_ERROR);
  });

  it("--help --version: --version wins (last flag), exits 0", () => {
    const r = runCli(["--help", "--version"]);
    expect(r.status).toBe(ExitCode.OK);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no subcommand exits 0 with help printed to stderr", () => {
    // Commander exits 0 (not non-zero) when no subcommand is given;
    // the top-level program has no required action, so absence of a
    // subcommand is treated as a help request, not an error. The help
    // text actually goes to stderr here (commander routes it through
    // `process.stderr` for the help-after-no-command code path) — flag
    // this so a future channel-routing change is visible.
    const r = runCli([]);
    expect(r.status).toBe(ExitCode.OK);
    expect(r.stderr).toMatch(/Usage:/);
    expect(r.stderr).toMatch(/Commands:/);
  });
});

describe("package metadata", () => {
  it("exports the expected package constants from package.json", async () => {
    const mod = await import("../src/index.js");
    expect(mod.PACKAGE_NAME).toBe("@hermes/center-geo");
    expect(mod.PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exports ExitCode with the spec values", async () => {
    const mod = await import("../src/index.js");
    expect(mod.ExitCode).toEqual({
      OK: 0,
      THRESHOLD: 1,
      EXTRACTION_GAP: 2,
      CONFIG_ERROR: 3,
      REPO_READ_ERROR: 4,
      INTERNAL: 5,
    });
  });
});

describe("center-geo CLI — T25 path proof", () => {
  it("emits a path hypothesis from symbol-tagged entry/sink config on the built artifact", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "center-geo-path-cli-"));
    try {
      await fs.mkdir(path.join(root, "src", "api"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "api", "flow.ts"),
        [
          "function sink() {",
          "  return 1;",
          "}",
          "function mid() {",
          "  return sink();",
          "}",
          "export function entry() {",
          "  return mid();",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      const configPath = path.join(root, "config.yaml");
      await fs.writeFile(
        configPath,
        [
          "include:",
          "  - 'src/**/*.{ts,tsx,js,jsx}'",
          "exclude:",
          "  - '**/node_modules/**'",
          "engines:",
          "  radial: { enabled: true }",
          "  cycle: { enabled: true }",
          "  boundary: { enabled: true }",
          "  anomaly: { enabled: true }",
          "  convergent: { enabled: true }",
          "  path:",
          "    enabled: true",
          "    allowed_edge_kinds: ['call']",
          "    entry_tags: ['entry']",
          "    sink_tags: ['sink']",
          "    long_path_min_length: 2",
          "    path_count_cap: 10",
          "    max_depth: 10",
          "scoring:",
          "  geometry_bonus_per_extra_geometry: 0.5",
          "  independence_bonus_per_extra_independent_method: 0.75",
          "  boundary_bonus: 1.0",
          "  state_bonus: 1.0",
          "  cycle_bonus: 0.75",
          "  test_gap_bonus: 0.5",
          "  contradiction_penalty: 1.5",
          "  capability_gap_penalty: 1.0",
          "report:",
          "  top_n_hypotheses: 20",
          "  redact: true",
          "boundaries:",
          "  tags:",
          "    entry:",
          "      symbols: ['src/api/flow.ts::entry']",
          "    sink:",
          "      symbols: ['src/api/flow.ts::sink']",
          "  forbidden_crossings: []",
          "",
        ].join("\n"),
        "utf8",
      );

      const r = runCli(["scan", "--format", "json", "--config", configPath, root]);
      expect([ExitCode.OK, ExitCode.THRESHOLD]).toContain(r.status);
      const report = JSON.parse(r.stdout) as {
        hypotheses: Array<{
          geometries?: string[];
          contributors?: Array<{ type?: string }>;
        }>;
      };
      const pathHypothesis = report.hypotheses.find(
        (hypothesis) => Array.isArray(hypothesis.geometries) && hypothesis.geometries.includes("path"),
      );
      expect(pathHypothesis).toBeTruthy();
      expect(pathHypothesis?.contributors?.some((contributor) => contributor.type === "long_path")).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("center-geo CLI — diff contract", () => {
  it("diff stdout stays parseable JSON with the decision line routed to stderr", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const f = await (await import("./fixtures/synthetic.js")).createFixture("small");
    const outA = await fs.mkdtemp(path.join(os.tmpdir(), "center-geo-diff-a-"));
    const outB = await fs.mkdtemp(path.join(os.tmpdir(), "center-geo-diff-b-"));
    try {
      const scanA = runCli(["scan", "--output-dir", outA, f.root]);
      const scanB = runCli(["scan", "--output-dir", outB, f.root]);
      expect([ExitCode.OK, ExitCode.THRESHOLD]).toContain(scanA.status);
      expect([ExitCode.OK, ExitCode.THRESHOLD]).toContain(scanB.status);

      const diff = runCli(["diff", path.join(outA, "report.json"), path.join(outB, "report.json")]);
      expect(diff.status).toBe(ExitCode.OK);
      const parsed = JSON.parse(diff.stdout) as {
        new_hypotheses: unknown[];
        resolved_hypotheses: unknown[];
        changed_hypotheses: unknown[];
      };
      expect(Array.isArray(parsed.new_hypotheses)).toBe(true);
      expect(Array.isArray(parsed.resolved_hypotheses)).toBe(true);
      expect(Array.isArray(parsed.changed_hypotheses)).toBe(true);
      expect(diff.stderr).toMatch(/# decision: ok/i);
    } finally {
      await fs.rm(outA, { recursive: true, force: true });
      await fs.rm(outB, { recursive: true, force: true });
      await f.cleanup();
    }
  });
});


describe("center-geo CLI — coverage (DeepSeek Critical #1)", () => {
  it("coverage.files_parsed correctly counts successful parses, not graph nodes", async () => {
    // Build a mixed fixture: 10 files, 5 intentionally broken.
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const f = await (await import("./fixtures/synthetic.js")).createMixedFixture(10, 5);
    try {
      const r = runCli(["scan", "--format", "json", f.root]);
      expect(r.status === 0 || r.status === 1).toBe(true);
      const report = JSON.parse(r.stdout);
      // 10 files total: 5 broken (fail to parse), 5 valid (each has 1
      // fileNode + 1 symbol node from `export function fnN()`).
      // DeepSeek Critical #1: the OLD code computed files_parsed as
      // (10 - 5) = 5 (lucky coincidence with allNodes.length - parseWarnings
      // where allNodes happened to be 10 fileNodes + 5 symbolNodes = 15).
      // The NEW code tracks parseSuccessCount directly = 5.
      expect(report.coverage.files_seen).toBe(10);
      expect(report.coverage.files_parsed).toBe(5);
      expect(report.coverage.files_failed).toBe(5);
    } finally {
      await f.cleanup();
    }
  });

  it("coverage.files_parsed on clean fixture: all files parsed", async () => {
    const f = await (await import("./fixtures/synthetic.js")).createFixture("small");
    try {
      const r = runCli(["scan", "--format", "json", f.root]);
      expect(r.status === 0 || r.status === 1).toBe(true);
      const report = JSON.parse(r.stdout);
      expect(report.coverage.files_seen).toBe(f.fileCount);
      expect(report.coverage.files_parsed).toBe(f.fileCount);
      expect(report.coverage.files_failed).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
});
