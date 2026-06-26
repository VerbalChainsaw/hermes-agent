import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  validateConfig,
  hashConfig,
  canonicalise,
  DEFAULT_CONFIG,
} from "../src/config/index.js";

/* ── helpers ─────────────────────────────────────────────────────── */

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "center-geo-config-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeConfig(name: string, content: string): Promise<string> {
  const path = join(tmp, name);
  await writeFile(path, content, "utf-8");
  return path;
}

/* ── loadConfig: defaults path ──────────────────────────────────── */

describe("loadConfig — no path (defaults)", () => {
  it("returns the default config when no path is given", async () => {
    const result = await loadConfig();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("<defaults>");
    expect(result.config.include).toEqual(DEFAULT_CONFIG.include);
    expect(result.config.engines).toEqual(DEFAULT_CONFIG.engines);
    expect(result.config.report).toEqual(DEFAULT_CONFIG.report);
  });

  it("returns a deterministic hash for the defaults", async () => {
    const a = await loadConfig();
    const b = await loadConfig();
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.hash).toBe(b.hash);
  });
});

/* ── loadConfig: valid YAML ─────────────────────────────────────── */

describe("loadConfig — valid YAML", () => {
  it("loads the spec example YAML verbatim", async () => {
    const path = await writeConfig(
      "spec.yaml",
      [
        "include:",
        "  - 'src/**/*.{ts,tsx,js,jsx}'",
        "exclude:",
        "  - '**/node_modules/**'",
        "engines:",
        "  radial: { enabled: true, max_depth: 4 }",
        "  cycle: { enabled: true }",
        "  boundary: { enabled: true }",
        "  anomaly: { enabled: true }",
        "  convergent: { enabled: true }",
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
        "",
      ].join("\n"),
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.include).toEqual(["src/**/*.{ts,tsx,js,jsx}"]);
    expect(result.config.engines.radial.enabled).toBe(true);
    expect(result.config.engines.radial.max_depth).toBe(4);
    expect(result.config.report.top_n_hypotheses).toBe(20);
    expect(result.config.report.redact).toBe(true);
  });

  it("returns the file's absolute path in `source`", async () => {
    const path = await writeConfig(
      "minimal.yaml",
      [
        "include: ['src/**']",
        "exclude: ['node_modules/**']",
        "engines:",
        "  radial: { enabled: true }",
        "  cycle: { enabled: true }",
        "  boundary: { enabled: true }",
        "  anomaly: { enabled: true }",
        "  convergent: { enabled: true }",
        "scoring:",
        "  geometry_bonus_per_extra_geometry: 0.5",
        "  independence_bonus_per_extra_independent_method: 0.75",
        "  boundary_bonus: 1.0",
        "  state_bonus: 1.0",
        "  cycle_bonus: 0.75",
        "  test_gap_bonus: 0.5",
        "  contradiction_penalty: 1.5",
        "  capability_gap_penalty: 1.0",
        "report: { top_n_hypotheses: 10, redact: false }",
        "",
      ].join("\n"),
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.toLowerCase()).toBe(path.toLowerCase());
  });
});

/* ── loadConfig: valid JSON ─────────────────────────────────────── */

describe("loadConfig — valid JSON", () => {
  it("loads JSON config from a .json path", async () => {
    const path = await writeConfig(
      "minimal.json",
      JSON.stringify({
        include: ["src/**"],
        exclude: ["node_modules/**"],
        engines: {
          radial: { enabled: true },
          cycle: { enabled: true },
          boundary: { enabled: true },
          anomaly: { enabled: true },
          convergent: { enabled: true },
        },
        scoring: {
          geometry_bonus_per_extra_geometry: 0.5,
          independence_bonus_per_extra_independent_method: 0.75,
          boundary_bonus: 1.0,
          state_bonus: 1.0,
          cycle_bonus: 0.75,
          test_gap_bonus: 0.5,
          contradiction_penalty: 1.5,
          capability_gap_penalty: 1.0,
        },
        report: { top_n_hypotheses: 5, redact: false },
      }),
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.include).toEqual(["src/**"]);
  });
});

/* ── loadConfig: invalid ────────────────────────────────────────── */

describe("loadConfig — invalid", () => {
  it("returns not_found when the path does not exist", async () => {
    const result = await loadConfig(join(tmp, "does-not-exist.yaml"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_found");
    expect(result.message).toMatch(/Could not read/);
  });

  it("returns parse_error on malformed YAML", async () => {
    const path = await writeConfig(
      "broken.yaml",
      "include: [unclosed bracket\nengines: : ::",
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("parse_error");
  });

  it("returns parse_error on malformed JSON", async () => {
    const path = await writeConfig("broken.json", "{ not valid json");
    const result = await loadConfig(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("parse_error");
  });

  it("returns validation_error when include is missing", async () => {
    const path = await writeConfig(
      "no-include.yaml",
      [
        "exclude: ['node_modules/**']",
        "engines:",
        "  radial: { enabled: true }",
        "  cycle: { enabled: true }",
        "  boundary: { enabled: true }",
        "  anomaly: { enabled: true }",
        "  convergent: { enabled: true }",
        "scoring:",
        "  geometry_bonus_per_extra_geometry: 0.5",
        "  independence_bonus_per_extra_independent_method: 0.75",
        "  boundary_bonus: 1.0",
        "  state_bonus: 1.0",
        "  cycle_bonus: 0.75",
        "  test_gap_bonus: 0.5",
        "  contradiction_penalty: 1.5",
        "  capability_gap_penalty: 1.0",
        "report: { top_n_hypotheses: 10, redact: false }",
        "",
      ].join("\n"),
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("validation_error");
    expect((result.details as { path: string }[]).some((e) => e.path === "include")).toBe(true);
  });

  it("returns validation_error when engines.radial.max_depth is negative", async () => {
    const path = await writeConfig(
      "bad-depth.yaml",
      [
        "include: ['src/**']",
        "exclude: ['node_modules/**']",
        "engines:",
        "  radial: { enabled: true, max_depth: -1 }",
        "  cycle: { enabled: true }",
        "  boundary: { enabled: true }",
        "  anomaly: { enabled: true }",
        "  convergent: { enabled: true }",
        "scoring:",
        "  geometry_bonus_per_extra_geometry: 0.5",
        "  independence_bonus_per_extra_independent_method: 0.75",
        "  boundary_bonus: 1.0",
        "  state_bonus: 1.0",
        "  cycle_bonus: 0.75",
        "  test_gap_bonus: 0.5",
        "  contradiction_penalty: 1.5",
        "  capability_gap_penalty: 1.0",
        "report: { top_n_hypotheses: 10, redact: false }",
        "",
      ].join("\n"),
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("validation_error");
    expect(JSON.stringify(result.details)).toMatch(/max_depth/);
  });

  it("returns validation_error when top_n_hypotheses is not a positive integer", async () => {
    const path = await writeConfig(
      "bad-report.yaml",
      [
        "include: ['src/**']",
        "exclude: ['node_modules/**']",
        "engines:",
        "  radial: { enabled: true }",
        "  cycle: { enabled: true }",
        "  boundary: { enabled: true }",
        "  anomaly: { enabled: true }",
        "  convergent: { enabled: true }",
        "scoring:",
        "  geometry_bonus_per_extra_geometry: 0.5",
        "  independence_bonus_per_extra_independent_method: 0.75",
        "  boundary_bonus: 1.0",
        "  state_bonus: 1.0",
        "  cycle_bonus: 0.75",
        "  test_gap_bonus: 0.5",
        "  contradiction_penalty: 1.5",
        "  capability_gap_penalty: 1.0",
        "report: { top_n_hypotheses: 0, redact: false }",
        "",
      ].join("\n"),
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("validation_error");
  });
});

/* ── hash determinism ──────────────────────────────────────────── */

describe("hashConfig — determinism", () => {
  it("produces the same hash for two equivalent configs (different key order)", () => {
    const a = canonicalise({ b: 2, a: 1 });
    const b = canonicalise({ a: 1, b: 2 });
    expect(a).toEqual(b);
    expect(hashConfig({ b: 2, a: 1 })).toBe(hashConfig({ a: 1, b: 2 }));
  });

  it("produces different hashes for configs that differ in any field", () => {
    const base = { include: ["src/**"], exclude: ["**/node_modules/**"] };
    const diff = { include: ["lib/**"], exclude: ["**/node_modules/**"] };
    expect(hashConfig(base)).not.toBe(hashConfig(diff));
  });

  it("returns a stable 16-char hex string for the default config", () => {
    const h = hashConfig(DEFAULT_CONFIG);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* ── validateConfig direct ─────────────────────────────────────── */

describe("validateConfig — direct", () => {
  it("accepts the default config shape", () => {
    const result = validateConfig(DEFAULT_CONFIG);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object", () => {
    const result = validateConfig("not an object");
    expect(result.ok).toBe(false);
  });

  it("rejects a config whose top-level is null", () => {
    const result = validateConfig(null);
    expect(result.ok).toBe(false);
  });

  it("rejects empty include glob string", () => {
    const bad = structuredClone(DEFAULT_CONFIG);
    bad.include = ["valid/**", ""];
    const result = validateConfig(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("empty"))).toBe(true);
  });

  it("rejects forbidden_crossings referencing undefined tags", () => {
    const bad = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
    (bad.boundaries as { tags: Record<string, unknown> }) = {
      tags: { ui: { globs: ["src/ui/**"] } },
      forbidden_crossings: [
        {
          from: "ui",
          to: "persistence", // not declared in tags above
          severity: "high",
          reason: "no UI → persistence",
        },
      ],
    };
    const result = validateConfig(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toMatch(/undefined tag/);
  });

  it("rejects unknown severity in forbidden_crossings", () => {
    const bad = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
    (bad.boundaries as { tags: Record<string, unknown> }) = {
      tags: { ui: { globs: ["src/ui/**"] }, persistence: { globs: ["src/db/**"] } },
      forbidden_crossings: [
        {
          from: "ui",
          to: "persistence",
          severity: "catastrophic", // not in the allowed set
          reason: "test",
        },
      ],
    };
    const result = validateConfig(bad);
    expect(result.ok).toBe(false);
  });
});

/* ── defaults merge ────────────────────────────────────────────── */

describe("loadConfig — defaults merge", () => {
  it("user's boundaries.tags overrides defaults but defaults for missing tags persist", async () => {
    const path = await writeConfig(
      "override-tags.yaml",
      [
        "include: ['src/**']",
        "exclude: ['node_modules/**']",
        "engines:",
        "  radial: { enabled: true }",
        "  cycle: { enabled: true }",
        "  boundary: { enabled: true }",
        "  anomaly: { enabled: true }",
        "  convergent: { enabled: true }",
        "scoring:",
        "  geometry_bonus_per_extra_geometry: 0.5",
        "  independence_bonus_per_extra_independent_method: 0.75",
        "  boundary_bonus: 1.0",
        "  state_bonus: 1.0",
        "  cycle_bonus: 0.75",
        "  test_gap_bonus: 0.5",
        "  contradiction_penalty: 1.5",
        "  capability_gap_penalty: 1.0",
        "report: { top_n_hypotheses: 10, redact: false }",
        "boundaries:",
        "  tags:",
        "    ui:",
        "      globs: ['custom/ui/**']", // override default 'src/ui/**' + 'src/components/**'
        "",
      ].join("\n"),
    );
    const result = await loadConfig(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The user override for 'ui' wins.
    expect(result.config.boundaries?.tags.ui?.globs).toEqual(["custom/ui/**"]);
    // The other default tags survive.
    expect(result.config.boundaries?.tags.api?.globs).toEqual([
      "src/api/**",
      "src/routes/**",
    ]);
    expect(result.config.boundaries?.tags.persistence?.globs).toEqual([
      "src/db/**",
      "src/repositories/**",
    ]);
  });
});

describe("loadConfig — partial config (T11+ fix)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cg-cfg-partial-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("omits scoring and report — falls back to DEFAULT_CONFIG", async () => {
    // The T11+ fix: previously omitting scoring or report caused
    // the validator to return {ok: false, errors: []} (the aggregate
    // check failed but no error was pushed). This surfaced as the
    // cryptic "Config validation failed (0 errors)" message.
    const yaml = `include: ["**/*.ts"]
exclude: ["**/*.test.ts", "**/dist/**"]
engines:
  radial: { enabled: true }
  cycle: { enabled: true }
  boundary: { enabled: true }
  anomaly: { enabled: true }
  convergent: { enabled: true }
`;
    const path = join(dir, "partial.yml");
    await writeFile(path, yaml, "utf-8");
    const r = await loadConfig(path);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The defaults are applied: scoring + report populated.
      expect(r.config.scoring.geometry_bonus_per_extra_geometry).toBe(0.5);
      expect(r.config.report.top_n_hypotheses).toBe(20);
    }
  });

  it("omits only scoring — report falls back to default", async () => {
    const yaml = `include: ["**/*.ts"]
exclude: ["**/*.test.ts"]
engines: { radial: { enabled: true } }
report: { top_n_hypotheses: 5, redact: true }
`;
    const path = join(dir, "r-only.yml");
    await writeFile(path, yaml, "utf-8");
    const r = await loadConfig(path);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.scoring.geometry_bonus_per_extra_geometry).toBe(0.5);
      expect(r.config.report.top_n_hypotheses).toBe(5);
    }
  });

  it("omits only report — scoring falls back to default", async () => {
    const yaml = `include: ["**/*.ts"]
exclude: ["**/*.test.ts"]
engines: { radial: { enabled: true } }
scoring: { geometry_bonus_per_extra_geometry: 0.7 }
`;
    const path = join(dir, "s-only.yml");
    await writeFile(path, yaml, "utf-8");
    const r = await loadConfig(path);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.scoring.geometry_bonus_per_extra_geometry).toBe(0.7);
      expect(r.config.report.top_n_hypotheses).toBe(20);
    }
  });
});
