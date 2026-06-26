/**
 * Snapshot tests (T22) — refactored to use the snapshot helper.
 *
 * For a small, deterministic fixture, the JSON / SARIF / Markdown
 * reports must be byte-stable. The capture-or-verify pattern:
 *   1. If the golden file doesn't exist, write it.
 *   2. Otherwise, compare byte-for-byte.
 *   3. On mismatch, throw with a STRUCTURED diff (path + from/to),
 *      not a 100KB raw string diff.
 *
 * To regenerate the golden after an intentional format change:
 *   rm -rf apps/center-geo/test/snapshots/small
 *   and re-run the test. The next run captures the new golden.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createFixture } from "./fixtures/synthetic.js";
import {
  compareSnapshots,
  formatDiff,
  assertSnapshot,
} from "./snapshot-helper.js";

const SNAPSHOT_DIR = "test/snapshots/small";
const CLI = "dist/cli/main.js";
const CWD = process.cwd();

describe("snapshot tests (T22) — small fixture, byte-stable reports", () => {
  let fixtureRoot = "";
  let reportDir = "";

  beforeAll(async () => {
    const f = await createFixture("small");
    fixtureRoot = f.root;
    reportDir = join(f.root, "..", "small-out");
  });

  it("captures or verifies 3 report files (json, md, sarif)", async () => {
    const r = spawnSync(
      "node",
      [CLI, "scan", "--output-dir", reportDir, "--format", "json", fixtureRoot],
      { cwd: CWD, encoding: "utf-8" },
    );
    expect(r.status === 0 || r.status === 1).toBe(true);
    // status 0 (no critical signals) OR 1 (THRESHOLD).
    // Snapshot tests pass on either.

    // For each of the 3 formats, run the scan and capture-or-verify.
    for (const name of ["report.json", "report.md", "report.sarif"]) {
      const golden = join(SNAPSHOT_DIR, name);
      const actual = await readFile(join(reportDir, name), "utf-8");
      const isJson = name.endsWith(".json") || name.endsWith(".sarif");
      // Capture-or-verify: if the golden doesn't exist, write it
      // and return without asserting (this run captured it). If the
      // golden exists, compare byte-for-byte.
      let exists = false;
      try { await readFile(golden, "utf-8"); exists = true; } catch { /* missing */ }
      if (!exists) {
        await mkdir(SNAPSHOT_DIR, { recursive: true });
        await writeFile(golden, actual, "utf-8");
        continue; // captured, no assertion
      }
      try {
        await assertSnapshot(golden, actual, { isJson });
      } catch (err) {
        throw new Error(
          `Snapshot mismatch for ${name}: ${(err as Error).message}`,
        );
      }
    }
  });

  it("regenerate-once mode: when goldens exist, they are stable across re-runs", async () => {
    // Run 3 times. All 3 outputs must match the golden byte-for-byte.
    for (let i = 0; i < 3; i++) {
      const r = spawnSync(
        "node",
        [CLI, "scan", "--output-dir", reportDir, "--format", "json", fixtureRoot],
        { cwd: CWD, encoding: "utf-8" },
      );
      expect(r.status === 0 || r.status === 1).toBe(true);
      const { readFile } = await import("node:fs/promises");
      const actual = await readFile(join(reportDir, "report.json"), "utf-8");
      const d = await compareSnapshots(
        join(SNAPSHOT_DIR, "report.json"),
        actual,
        { isJson: true },
      );
      if (d.kind !== "match") {
        throw new Error(formatDiff(d));
      }
    }
  });

  it("two runs of the same fixture produce byte-identical output", async () => {
    // Pure stability: run twice, expect byte-equal.
    const r1 = spawnSync(
      "node",
      [CLI, "scan", "--output-dir", `${reportDir}-s1`, "--format", "json", fixtureRoot],
      { cwd: CWD, encoding: "utf-8" },
    );
    const r2 = spawnSync(
      "node",
      [CLI, "scan", "--output-dir", `${reportDir}-s2`, "--format", "json", fixtureRoot],
      { cwd: CWD, encoding: "utf-8" },
    );
    expect(r1.status === 0 || r1.status === 1).toBe(true);
    expect(r2.status === 0 || r2.status === 1).toBe(true);

    const { readFile, rm: rmAsync } = await import("node:fs/promises");
    const c1 = await readFile(join(`${reportDir}-s1`, "report.json"), "utf-8");
    const c2 = await readFile(join(`${reportDir}-s2`, "report.json"), "utf-8");
    expect(c1).toBe(c2);

    // Cleanup the second run.
    await rmAsync(`${reportDir}-s1`, { recursive: true, force: true });
    await rmAsync(`${reportDir}-s2`, { recursive: true, force: true });
  });
});
