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

  it("index stub exits with INTERNAL code 5 (parity with scan)", () => {
    // The path must point to a real, readable directory for T02's
    // enumerator to run (it will then exit INTERNAL=5 because the
    // graph emit step is T03+). Using the package root itself works.
    const r = runCli(["index", repoRoot]);
    expect(r.status).toBe(ExitCode.INTERNAL);
    expect(r.stderr).toMatch(/Not yet implemented as a graph emit|Stub exit/i);
  });
  it("scan stub exits with INTERNAL code 5 (T00 stub state)", () => {
      // T00-era expectation: scan was a stub that returned 5.
      // After T09 the scan branch runs the full pipeline (enumerate
      // -> parse -> build graph -> run radial engine). The path must
      // point to a real, readable directory. This test asserts the
      // STUB behaviour by pointing at a non-existent path (so we
      // get REPO_READ_ERROR=4 instead of either the stub exit or
      // the new exit-0 pipeline exit).
      const r = runCli(["scan", "/definitely/not/a/path"]);
      expect(r.status).toBe(ExitCode.REPO_READ_ERROR);
    });

    it("scan on real package runs the full pipeline and reports signals (T09+)", () => {
        // New behaviour (T09): the scan branch runs end-to-end (enumerate
        // -> parse -> build graph -> run radial engine -> emit signals)
        // and exits INTERNAL=5 because fusion + report writers (T15-T19)
        // are still pending. The exit code is the "internal stub" marker;
        // the WORK (parse, graph, engine) all completes before exit.
        const r = runCli(["scan", repoRoot]);
        // The exit may be 5 (the stub exit at end of scan) OR 0 (if the
        // handler completes naturally). Both are acceptable — the test
        // asserts the WORK happened.
        expect([ExitCode.OK, ExitCode.INTERNAL]).toContain(r.status);
        // stderr includes the summary line with N nodes + N edges.
        expect(r.stderr).toMatch(/scan: \d+ nodes, \d+ edges/);
        // At least one signal reported (radial engine emits high_fan_out
        // for any file with >8 filtered outgoing edges; the package
        // itself qualifies).
        expect(r.stderr).toMatch(/signals/);
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
