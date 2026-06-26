import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

/**
 * Locate Node + the built CLI entrypoint. We test the BUILT artifact,
 * not the source via tsx, because:
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
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 15_000,
  });
}

describe("center-geo CLI (T00 smoke)", () => {
  it("--version exits 0 and prints the version", () => {
    const r = runCli(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help exits 0 and includes the tool name and description", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/center-geo/);
    expect(r.stdout).toMatch(/CENTER-MULTIGEOMETRY/);
    expect(r.stdout).toMatch(/multi-geometry/i);
  });

  it("index subcommand --help exits 0 and is documented", () => {
    const r = runCli(["index", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Index a repository/i);
    expect(r.stdout).toMatch(/--config/);
    expect(r.stdout).toMatch(/--output/);
  });

  it("scan subcommand --help exits 0 and is documented", () => {
    const r = runCli(["scan", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Run a full scan/i);
    expect(r.stdout).toMatch(/--ci/);
  });

  it("index without args exits non-zero (missing required arg)", () => {
    const r = runCli(["index"]);
    // commander exits non-zero when required argument missing
    expect(r.status).not.toBe(0);
  });

  it("scan with no implementation exits with INTERNAL code 5", () => {
    // T00: subcommand handlers are stubs that exit INTERNAL.
    // Once T02/T09 land this assertion will need to change.
    const r = runCli(["scan", "C:\\does-not-exist-yet"]);
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/not yet implemented/i);
  });
});

describe("package metadata", () => {
  it("exports the expected package constants", async () => {
    const mod = await import("../src/index.js");
    expect(mod.PACKAGE_NAME).toBe("@hermes/center-geo");
    expect(mod.PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
