/**
 * Snapshot tests (T22).
 *
 * For a small, deterministic fixture, the JSON / SARIF / Markdown
 * reports must be byte-stable. We capture the expected output the
 * first time and compare on every subsequent test run.
 *
 * Pattern:
 *   1. Generate the small fixture (10 files, deterministic).
 *   2. Run `scan --output-dir <tmp> --format json <fixture>`.
 *   3. Read the 3 report files and compare to golden files in
 *      test/snapshots/.
 *   4. If the golden files don't exist yet, write them (so the
 *      initial run creates the golden; subsequent runs verify).
 *
 * To regenerate the golden after an intentional format change:
 *   rm -rf apps/center-geo/test/snapshots/small
 *   and re-run the test.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createFixture } from "./fixtures/synthetic.js";

const SNAPSHOT_DIR = "test/snapshots/small";
const CLI = "dist/cli/main.js";
const CWD = process.cwd();

async function ensureSnapshotDir(): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
}

async function goldenExists(name: string): Promise<boolean> {
  try {
    await readFile(join(SNAPSHOT_DIR, name), "utf-8");
    return true;
  } catch {
    return false;
  }
}

async function writeGolden(name: string, content: string): Promise<void> {
  await writeFile(join(SNAPSHOT_DIR, name), content, "utf-8");
}

async function readGolden(name: string): Promise<string> {
  return await readFile(join(SNAPSHOT_DIR, name), "utf-8");
}

describe("snapshot tests (T22) — small fixture, byte-stable reports", () => {
  let fixtureRoot = "";
  let reportDir = "";

  beforeAll(async () => {
    const f = await createFixture("small");
    fixtureRoot = f.root;
    reportDir = await mkdir(join(f.root, "..", "small-out"), { recursive: true }).then(() =>
      join(f.root, "..", "small-out"),
    );
  });

  it("regenerates the small fixture end-to-end and writes 3 report files", async () => {
    const r = spawnSync(
      "node",
      [CLI, "scan", "--output-dir", reportDir, "--format", "json", fixtureRoot],
      { cwd: CWD, encoding: "utf-8" },
    );
    expect([0, 1]).toContain(r.status);
    // Files exist.
    for (const name of ["report.json", "report.md", "report.sarif"]) {
      const path = join(reportDir, name);
      const content = await readFile(path, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("JSON report is stable across runs (byte-for-byte when sorted)", async () => {
    // Run twice; both should produce identical JSON (modulo the
    // deterministic id which is content-derived, so a true byte-match
    // is expected if nothing changed).
    const r1 = spawnSync(
      "node",
      [CLI, "scan", "--output-dir", `${reportDir}-1`, "--format", "json", fixtureRoot],
      { cwd: CWD, encoding: "utf-8" },
    );
    const r2 = spawnSync(
      "node",
      [CLI, "scan", "--output-dir", `${reportDir}-2`, "--format", "json", fixtureRoot],
      { cwd: CWD, encoding: "utf-8" },
    );
    expect([0, 1]).toContain(r1.status);
    expect([0, 1]).toContain(r2.status);
    const c1 = await readFile(join(`${reportDir}-1`, "report.json"), "utf-8");
    const c2 = await readFile(join(`${reportDir}-2`, "report.json"), "utf-8");
    expect(c1).toBe(c2);
    // Cleanup.
    await rm(`${reportDir}-1`, { recursive: true, force: true });
    await rm(`${reportDir}-2`, { recursive: true, force: true });
  });

  it("creates the golden files on first run, then verifies on subsequent", async () => {
    await ensureSnapshotDir();
    const r = spawnSync(
      "node",
      [CLI, "scan", "--output-dir", reportDir, "--format", "json", fixtureRoot],
      { cwd: CWD, encoding: "utf-8" },
    );
    expect([0, 1]).toContain(r.status);

    for (const name of ["report.json", "report.md", "report.sarif"]) {
      const actual = await readFile(join(reportDir, name), "utf-8");
      if (!(await goldenExists(name))) {
        // First run: capture the golden.
        await writeGolden(name, actual);
      } else {
        // Subsequent runs: compare.
        const expected = await readGolden(name);
        // Markdown has dynamic fields (timestamps, if any) — the
        // current markdown is fully static, so byte-match is fine.
        // JSON is deterministic; SARIF is deterministic.
        expect(actual).toBe(expected);
      }
    }
  });

  it("regenerate-once mode: when goldens exist, they are stable across re-runs", async () => {
    // Run 3 times. All 3 outputs must match the golden.
    if (!(await goldenExists("report.json"))) {
      // Goldens don't exist yet — skip (the previous test creates them).
      return;
    }
    for (let i = 0; i < 3; i++) {
      const r = spawnSync(
        "node",
        [CLI, "scan", "--output-dir", reportDir, "--format", "json", fixtureRoot],
        { cwd: CWD, encoding: "utf-8" },
      );
      expect([0, 1]).toContain(r.status);
      const actual = await readFile(join(reportDir, "report.json"), "utf-8");
      const expected = await readGolden("report.json");
      expect(actual).toBe(expected);
    }
  });
});
