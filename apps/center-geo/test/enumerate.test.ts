import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enumerateFiles,
  buildMatcher,
  matchesAny,
  toPosixPath,
  classify,
  activeTestGlobs,
  activeGeneratedGlobs,
} from "../src/enumerate/index.js";
import { DEFAULT_CONFIG } from "../src/config/default.js";
import type { Config } from "../src/config/types.js";

/* ── fixture helpers ────────────────────────────────────────────── */

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "center-geo-enum-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeFile_(rel: string, content = ""): Promise<void> {
  const abs = join(tmp, rel);
  const dir = abs.substring(0, abs.lastIndexOf("\\"));
  await mkdir(dir, { recursive: true });
  await writeFile(abs, content, "utf-8");
}

/* ── toPosixPath ───────────────────────────────────────────────── */

describe("toPosixPath", () => {
  it("converts Windows backslashes to forward slashes", () => {
    expect(toPosixPath("src\\cli\\main.ts")).toBe("src/cli/main.ts");
  });
  it("strips Windows drive-letter prefix but preserves the leading slash", () => {
    // Leading slash is required for POSIX-absolute paths used by
    // picomatch. C:\Users\me\src\index.ts -> /Users/me/src/index.ts.
    expect(toPosixPath("C:\\Users\\me\\src\\index.ts")).toBe(
      "/Users/me/src/index.ts",
    );
  });
  it("leaves POSIX paths unchanged", () => {
    expect(toPosixPath("src/cli/main.ts")).toBe("src/cli/main.ts");
  });
});

/* ── matchesAny ────────────────────────────────────────────────── */

describe("matchesAny", () => {
  it("returns true when path matches a pattern", () => {
    expect(matchesAny("src/cli/main.ts", ["src/**/*.ts"])).toBe(true);
  });
  it("returns false when no patterns match", () => {
    expect(matchesAny("src/cli/main.ts", ["lib/**/*.ts"])).toBe(false);
  });
  it("returns false for empty pattern list", () => {
    expect(matchesAny("src/cli/main.ts", [])).toBe(false);
  });
  it("matches deep globs correctly", () => {
    expect(matchesAny("a/b/c/d/e.ts", ["a/**/e.ts"])).toBe(true);
  });
  it("matches brace expansion", () => {
    expect(matchesAny("src/index.ts", ["src/*.{ts,tsx,js}"])).toBe(true);
    expect(matchesAny("src/index.py", ["src/*.{ts,tsx,js}"])).toBe(false);
  });
  it("honors negation in include list (via buildMatcher's exclude handling)", () => {
    // matchesAny() itself doesn't process `!` — that's buildMatcher()'s
    // job (it splits include vs exclude). The semantic the user wants
    // is "include this but exclude that", and buildMatcher() does it.
    const m = buildMatcher(["**/*.ts"], ["**/node_modules/**"]);
    expect(m("src/a.ts")).toBe(true);
    expect(m("node_modules/pkg/a.ts")).toBe(false);
  });
});

/* ── buildMatcher ──────────────────────────────────────────────── */

describe("buildMatcher", () => {
  it("returns false for empty include", () => {
    const m = buildMatcher([], []);
    expect(m("anything")).toBe(false);
  });
  it("includes when path matches include AND not exclude", () => {
    const m = buildMatcher(["src/**/*.ts"], ["**/test.ts"]);
    expect(m("src/cli/main.ts")).toBe(true);
    expect(m("src/cli/test.ts")).toBe(false);
  });
});

/* ── classify ──────────────────────────────────────────────────── */

describe("classify", () => {
  const config: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  it("classifies a regular source as source", () => {
    expect(classify("src/cli/main.ts", config)).toBe("source");
  });
  it("classifies a test file as test (wins over generated)", () => {
    expect(classify("src/cli/main.test.ts", config)).toBe("test");
  });
  it("classifies a generated file as generated", () => {
    expect(classify("src/api/client.generated.ts", config)).toBe("generated");
  });
  it("honors user-supplied test globs", () => {
    const custom = { ...config, tests: { globs: ["**/*.spec.ts"] } };
    expect(classify("src/main.spec.ts", custom)).toBe("test");
    expect(classify("src/main.test.ts", custom)).toBe("source");
  });
  it("honors user-supplied generated globs", () => {
    const custom = {
      ...config,
      generated: { globs: ["**/autogen/**"] },
    };
    expect(classify("autogen/api.ts", custom)).toBe("generated");
    expect(classify("src/api/client.generated.ts", custom)).toBe("source");
  });
  it("activeTestGlobs falls back to defaults when unset", () => {
    const c = { ...config, tests: undefined };
    expect(activeTestGlobs(c)).toContain("**/*.test.ts");
  });
  it("activeGeneratedGlobs falls back to defaults when unset", () => {
    const c = { ...config, generated: undefined };
    expect(activeGeneratedGlobs(c)).toContain("**/*.generated.ts");
  });
});

/* ── enumerateFiles: positive cases ────────────────────────────── */

describe("enumerateFiles — happy paths", () => {
  it("enumerates an empty repo (returns no_files_matched if include is too narrow)", async () => {
    const r = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("no_files_matched");
  });

  it("enumerates TS files matching default include globs", async () => {
    await writeFile_("src/a.ts", "export const a = 1;");
    await writeFile_("src/b.ts", "export const b = 2;");
    await writeFile_("src/c.txt", "not source");
    const r = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paths = r.files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("classifies files: source, test, generated", async () => {
    await writeFile_("src/a.ts", "// src");
    await writeFile_("src/a.test.ts", "// test");
    await writeFile_("src/a.generated.ts", "// gen");
    const r = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts.source).toBe(1);
    expect(r.counts.test).toBe(1);
    expect(r.counts.generated).toBe(1);
    const byPath = Object.fromEntries(r.files.map((f) => [f.relativePath, f.classification]));
    expect(byPath["src/a.ts"]).toBe("source");
    expect(byPath["src/a.test.ts"]).toBe("test");
    expect(byPath["src/a.generated.ts"]).toBe("generated");
  });

  it("returns deterministic order (sorted by id)", async () => {
    await writeFile_("src/z.ts", "");
    await writeFile_("src/a.ts", "");
    await writeFile_("src/m.ts", "");
    const r = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.map((f) => f.relativePath)).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
  });

  it("computes stable SHA-256 content hash", async () => {
    await writeFile_("src/a.ts", "export const a = 1;");
    const r1 = await enumerateFiles(tmp, DEFAULT_CONFIG);
    const r2 = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.files[0].contentHash).toBe(r2.files[0].contentHash);
    // SHA-256 hex is 64 chars.
    expect(r1.files[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces stable enumeration hash across two runs", async () => {
    await writeFile_("src/a.ts", "1");
    await writeFile_("src/b.ts", "2");
    const r1 = await enumerateFiles(tmp, DEFAULT_CONFIG);
    const r2 = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r1.hash).toBe(r2.hash);
  });

  it("file id format is `file:<posix-path>`", async () => {
    await writeFile_("src/cli/main.ts", "");
    const r = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files[0].id).toBe("file:src/cli/main.ts");
  });
});

/* ── enumerateFiles: excludes & defaults ──────────────────────── */

describe("enumerateFiles — excludes & heavy-folder defaults", () => {
  it("excludes files matching user exclude patterns", async () => {
    await writeFile_("src/a.ts", "");
    await writeFile_("src/skip.ts", "");
    await writeFile_("build/output.js", "");
    const custom = {
      ...DEFAULT_CONFIG,
      exclude: ["**/skip.ts", "**/build/**"],
    };
    const r = await enumerateFiles(tmp, custom);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.map((f) => f.relativePath)).toEqual(["src/a.ts"]);
  });

  it("default exclude globs cover node_modules, dist, build, .git, etc.", async () => {
    await writeFile_("src/keep.ts", "");
    await writeFile_("node_modules/pkg/index.js", "");
    await writeFile_("dist/index.js", "");
    await writeFile_("build/output.js", "");
    await writeFile_(".git/HEAD", "");
    await writeFile_("coverage/lcov.info", "");
    const r = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paths = r.files.map((f) => f.relativePath);
    expect(paths).toContain("src/keep.ts");
    expect(paths).not.toContain("node_modules/pkg/index.js");
    expect(paths).not.toContain("dist/index.js");
    expect(paths).not.toContain("build/output.js");
    expect(paths).not.toContain(".git/HEAD");
    expect(paths).not.toContain("coverage/lcov.info");
  });
});

/* ── enumerateFiles: failures ──────────────────────────────────── */

describe("enumerateFiles — failures", () => {
  it("returns repo_not_found when path does not exist", async () => {
    const r = await enumerateFiles(join(tmp, "does-not-exist"), DEFAULT_CONFIG);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("repo_not_found");
  });

  it("returns repo_read_error when path is a file, not a directory", async () => {
    await writeFile_("a-file.txt", "x");
    const r = await enumerateFiles(join(tmp, "a-file.txt"), DEFAULT_CONFIG);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("repo_read_error");
  });
});

/* ── enumerateFiles: symlinks ──────────────────────────────────── */

describe("enumerateFiles — symlink handling", () => {
  it("does not follow symlinks (avoids loops)", async () => {
    await writeFile_("src/real.ts", "");
    // Create a symlink loop: link → itself
    try {
      await symlink(join(tmp, "loop"), join(tmp, "loop2"), "dir");
    } catch {
      // Some Windows configs disallow symlink creation without elevation.
      // Skip the test in that case.
      return;
    }
    const r = await enumerateFiles(tmp, DEFAULT_CONFIG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Should complete without infinite recursion. The loop/loop2 entry
    // should NOT be in the output (symlinks are skipped).
    const paths = r.files.map((f) => f.relativePath);
    expect(paths).toContain("src/real.ts");
    // No entry should have a path that mentions loop2 (the symlink target).
    for (const p of paths) {
      expect(p).not.toMatch(/loop2/);
    }
  });
});
