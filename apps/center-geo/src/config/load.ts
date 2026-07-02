/**
 * Config loader.
 *
 * Reads YAML or JSON from a path, parses it, applies defaults for
 * missing optional fields, validates the shape, and returns a
 * fully-typed `Config` plus its deterministic hash. Does NOT merge
 * top-level fields across files (no `--config a.yaml --config b.yaml`
 * layering in T01) — that lands in a later ticket if needed.
 *
 * Failure modes (callers should map to ExitCode per FR10):
 *   - path not found / not readable       -> CONFIG_ERROR (treat as bad user input)
 *   - parse error (malformed YAML/JSON)  -> CONFIG_ERROR
 *   - validation error (shape/value)      -> CONFIG_ERROR
 *   - internal loader bug                 -> INTERNAL (re-thrown)
 *
 * The loader does NOT throw on bad user input — it returns a typed
 * `LoadFailure` result so the CLI can format errors consistently.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { load as parseYaml, JSON_SCHEMA } from "js-yaml";

import { DEFAULT_CONFIG } from "./default.js";
import { validateConfig } from "./validate.js";
import { hashConfig } from "./hash.js";
import type { Config } from "./types.js";

export interface LoadFailure {
  ok: false;
  /** Human-readable message safe for stderr. */
  message: string;
  /** Machine-readable code for callers that want to switch on it. */
  code: "not_found" | "parse_error" | "validation_error";
  /** Optional structured detail (e.g. validation error list). */
  details?: unknown;
}

export interface LoadSuccess {
  ok: true;
  config: Config;
  /** SHA-flavoured hash of the resolved config. */
  hash: string;
  /** Absolute path of the loaded file, or "<default>" if no file was given. */
  source: string;
}

export type LoadResult = LoadSuccess | LoadFailure;

/** Detect file format from extension. YAML also covers .yml. */
function detectFormat(path: string): "yaml" | "json" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  return "yaml";
}

export async function loadConfig(configPath?: string): Promise<LoadResult> {
  let rawText: string;
  let source: string;
  let raw: unknown;

  if (!configPath) {
    // No file given — use defaults. The source is the in-code defaults,
    // so the hash is computed against DEFAULT_CONFIG. Users who want
    // to inspect what defaults are in effect can run `center-geo print-config`
    // (TBD in a later ticket) or look at src/config/default.ts.
    raw = DEFAULT_CONFIG;
    source = "<defaults>";
  } else {
    const absPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
    try {
      rawText = await readFile(absPath, "utf-8");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: "not_found",
        message: `Could not read config file at ${absPath}: ${reason}`,
      };
    }
    const format = detectFormat(absPath);
    try {
      // Use JSON_SCHEMA (the most restrictive js-yaml schema) so that
      // user config cannot contain custom YAML tags or constructor
      // payloads. Equivalent to yaml.safe_load but explicit.
      raw = format === "json" ? JSON.parse(rawText) : parseYaml(rawText, { schema: JSON_SCHEMA });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: "parse_error",
        message: `Could not parse ${format.toUpperCase()} config at ${absPath}: ${reason}`,
      };
    }
    source = absPath;
  }

  // The validator expects an object (top-level must be a YAML mapping / JSON object).
  // Users sometimes pass a scalar by mistake; surface a clear error rather than
  // silently merging into defaults.
  if (raw === null || raw === undefined) {
    return {
      ok: false,
      code: "parse_error",
      message: "Config is empty (parsed to null/undefined). Expected an object.",
    };
  }

  const result = validateConfig(raw);
  if (result.ok === false) {
    const errCount = result.errors.length;
    return {
      ok: false,
      code: "validation_error",
      message:
        `Config validation failed (${errCount} error` +
        (errCount === 1 ? "" : "s") +
        "). See details for the full list.",
      details: result.errors,
    };
  }

  // Layer the validated user config OVER the defaults so any field the
  // user omitted still gets the default value. (The validator's required-
  // field check has already enforced that anything the user DID provide is
  // valid; defaults fill in the gaps.)
  const config: Config = mergeWithDefaults(result.config);

  return {
    ok: true,
    config,
    hash: hashConfig(config),
    source,
  };
}

/**
 * Deep-merge validated user config into DEFAULT_CONFIG. The validated
 * user config is type-checked and known-good; defaults fill missing
 * optional fields. Top-level required fields are guaranteed by the
 * validator; optional sections (generated, tests, boundaries, sinks,
 * ci) merge field-by-field.
 */
function mergeWithDefaults(user: Config): Config {
  return {
    include: user.include,
    exclude: user.exclude,
    engines: mergeEngines(user.engines),
    scoring: user.scoring,
    report: user.report,
    generated: user.generated ?? DEFAULT_CONFIG.generated,
    tests: user.tests ?? DEFAULT_CONFIG.tests,
    boundaries: mergeBoundaries(user.boundaries),
    sinks: user.sinks,
    ci: user.ci ?? DEFAULT_CONFIG.ci,
  };
}

function mergeEngines(user: Config["engines"]): Config["engines"] {
  const def = DEFAULT_CONFIG.engines;
  return {
    radial: { ...def.radial, ...user.radial },
    cycle: { ...def.cycle, ...user.cycle },
    boundary: { ...def.boundary, ...user.boundary },
    anomaly: { ...def.anomaly, ...user.anomaly },
    convergent: { ...def.convergent, ...user.convergent },
    path: { ...def.path, ...user.path },
  };
}

function mergeBoundaries(
  user: Config["boundaries"],
): Config["boundaries"] | undefined {
  if (!user) return DEFAULT_CONFIG.boundaries;
  const def = DEFAULT_CONFIG.boundaries;
  if (!def) return user;
  // Merge tags: defaults provide baseline layer definitions, user can override
  // any individual tag by name. The forbidden_crossings list is user-only
  // (defaults don't ship with forbidden crossings — that's a project-specific
  // architectural decision).
  return {
    tags: { ...def.tags, ...user.tags },
    forbidden_crossings: user.forbidden_crossings,
  };
}
