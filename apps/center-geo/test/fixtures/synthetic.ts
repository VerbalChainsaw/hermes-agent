/**
 * Synthetic test fixtures (T20).
 *
 * Generates a TypeScript monorepo at multiple sizes (small/medium/large)
 * with deterministic content. The fixture:
 *   - Creates files in <tmp>/fixture-{size}/src/...
 *   - Includes known import patterns (linear chains, diamonds, cycles,
 *     hubs) so signal-isolation is possible.
 *   - Cleans up the directory on test exit.
 *
 * Sizes (target):
 *   - small:  10 files, ~20 edges
 *   - medium: 100 files, ~200 edges
 *   - large:  1000 files, ~2000 edges
 *
 * For perf benchmarks, the LARGE fixture exercises the O(V+E)
 * algorithms at scale.
 */

import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FixtureSize = "small" | "medium" | "large";

const SIZE_TO_FILES: Record<FixtureSize, number> = {
  small: 10,
  medium: 100,
  large: 1000,
};

/**
 * Generate a fixture repo. Layout:
 *
 *   {root}/src/a/a.ts        (imports nothing)
 *   {root}/src/b/b.ts        (imports a)
 *   {root}/src/c/c.ts        (imports a, b)
 *   ...
 *   {root}/src/hub/hub.ts    (imports many; high fan-out target)
 *   {root}/src/util/util.ts  (imported by many; high fan-in target)
 *   {root}/src/cycle/a.ts -> b.ts -> c.ts -> a.ts (deliberate cycle)
 *
 * Plus a fake `package.json` so the enumerator's globbing works.
 */
export async function createFixture(
  size: FixtureSize,
): Promise<{ root: string; fileCount: number; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "cg-fixture-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", type: "module" }, null, 2),
    "utf-8",
  );

  const fileCount = SIZE_TO_FILES[size];
  const fileIds: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    fileIds.push("f" + i);
  }

  // 1. Each file imports a few earlier files (linear chain feel).
  // 2. The first file (f0) and last file (fN-1) are hubs:
  //    - f0 is imported by everyone (high fan-in)
  //    - fN-1 imports everyone (high fan-out)
  // 3. A small 3-node cycle is added at indices 0/1/2 (f0 imports
  //    f1 and f2, f1 imports f2, f2 imports f0).
  for (let i = 0; i < fileCount; i++) {
    const id = fileIds[i];
    const imports: string[] = [];
    // Cycle: f0, f1, f2 form a triangle (always, even for large).
    if (i === 0) {
      imports.push(fileIds[1], fileIds[2]);
    } else if (i === 1) {
      imports.push(fileIds[2]);
    } else if (i === 2) {
      imports.push(fileIds[0]);
    }
    // Last file is a high-fan-out hub.
    if (i === fileCount - 1 && i > 2) {
      for (let j = 0; j < Math.min(20, i); j++) {
        imports.push(fileIds[j]);
      }
    } else if (i > 2) {
      // 0-2 random earlier imports.
      const n = (i % 3);
      for (let k = 0; k < n; k++) {
        const targetIdx = (i * 7 + k * 13) % i;
        imports.push(fileIds[targetIdx]);
      }
    }
    // Dedupe.
    const seen = new Set<string>();
    const uniq = imports.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));

    const importLines = uniq
      .map((j) => `import { f as ${j} } from "./${j}.js";`)
      .join("\n");
    const body = `export function f() { return ${i}; }\n`;
    const src = importLines ? `${importLines}\n\n${body}` : body;
    await writeFile(join(root, "src", `${id}.ts`), src, "utf-8");
  }

  return {
    root,
    fileCount: fileIds.length,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
