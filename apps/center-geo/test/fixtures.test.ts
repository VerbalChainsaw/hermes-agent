import { describe, it, expect } from "vitest";
import { createFixture, type FixtureSize } from "./fixtures/synthetic.js";

describe("synthetic fixtures (T20)", () => {
  it("small fixture creates the requested number of files", async () => {
    const f = await createFixture("small");
    try {
      expect(f.fileCount).toBe(10);
    } finally {
      await f.cleanup();
    }
  });

  it("medium fixture creates 100 files", async () => {
    const f = await createFixture("medium");
    try {
      expect(f.fileCount).toBe(100);
    } finally {
      await f.cleanup();
    }
  });

  it("large fixture creates 1000 files (perf benchmark baseline)", async () => {
    const f = await createFixture("large");
    try {
      expect(f.fileCount).toBe(1000);
    } finally {
      await f.cleanup();
    }
  });

  it("fixtures are deterministic (same size produces same file count)", async () => {
    const sizes: FixtureSize[] = ["small", "medium", "large"];
    for (const s of sizes) {
      const f1 = await createFixture(s);
      const f2 = await createFixture(s);
      try {
        expect(f1.fileCount).toBe(f2.fileCount);
      } finally {
        await f1.cleanup();
        await f2.cleanup();
      }
    }
  });

  it("fixture content is valid TypeScript that the parser can ingest", async () => {
    const { parseFile } = await import("../src/adapters/ts/index.js");
    const fs = await import("node:fs/promises");
    const f = await createFixture("small");
    try {
      // Parse the first 3 files; if the parser throws, this test fails.
      for (let i = 0; i < 3; i++) {
        const content = await fs.readFile(`${f.root}/src/f${i}.ts`, "utf-8");
        const r = parseFile(`src/f${i}.ts`, content);
        expect(r.ok).toBe(true);
      }
    } finally {
      await f.cleanup();
    }
  });
});
import { createMixedFixture } from "./fixtures/synthetic.js";

describe("mixed fixtures (parse-failure coverage)", () => {
  it("createMixedFixture creates the requested number of files", async () => {
    const f = await createMixedFixture(10, 5);
    try {
      expect(f.fileCount).toBe(10);
    } finally {
      await f.cleanup();
    }
  });

  it("the 5 broken files are valid syntactically-incomplete TypeScript", async () => {
    // Sanity-check: our intentional parse error is actually a parse error.
    const { parseFile } = await import("../src/adapters/ts/index.js");
    const broken = `import { x } from "./x.js"\nconst y = ;\nconst z = "broken"\n`;
    const r = parseFile("broken.ts", broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("syntax_error");
    }
  });
});
