/**
 * Hand-rolled runtime config validator.
 *
 * Returns either a fully-typed `Config` or a list of `ValidationError`s.
 * Callers (load.ts) map the error list to ExitCode.CONFIG_ERROR=3 per
 * FR10. The validator never throws on malformed input — only on bugs
 * in the validator itself.
 *
 * Validation rules are derived from docs/01 §FR5 (engine config),
 * §FR6 (required engines), §FR8 (fusion inputs), §FR11 (CI mode
 * thresholds), §FR12 (diff mode), and the YAML example at
 * examples/center-geometry.config.yaml.
 */

import type {
  BoundaryCrossing,
  Config,
  EnginesConfig,
  PathPattern,
} from "./types.js";
import { DEFAULT_CONFIG } from "./default.js";

export interface ValidationError {
  /** Dotted path to the offending field (e.g. "engines.radial.max_depth"). */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; config: Config }
  | { ok: false; errors: ValidationError[] };

/* ── helpers ─────────────────────────────────────────────────────── */

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === "string");
}

function expectObject(
  obj: Record<string, unknown>,
  key: string,
  errors: ValidationError[],
): Record<string, unknown> | null {
  const v = obj[key];
  if (v === undefined) return null; // caller decides if required
  if (!isObject(v)) {
    errors.push({ path: key, message: `expected object, got ${typeof v}` });
    return null;
  }
  return v;
}

function expectStringArray(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
  errors: ValidationError[],
): string[] | null {
  const v = obj[key];
  if (v === undefined) {
    if (required) errors.push({ path: key, message: "missing required field" });
    return null;
  }
  if (!isStringArray(v)) {
    errors.push({
      path: key,
      message: `expected array of strings, got ${Array.isArray(v) ? "array of non-strings" : typeof v}`,
    });
    return null;
  }
  return v;
}

function expectString(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
  errors: ValidationError[],
): string | null {
  const v = obj[key];
  if (v === undefined) {
    if (required) errors.push({ path: key, message: "missing required field" });
    return null;
  }
  if (typeof v !== "string") {
    errors.push({ path: key, message: `expected string, got ${typeof v}` });
    return null;
  }
  return v;
}

function expectNumber(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
  errors: ValidationError[],
): number | null {
  const v = obj[key];
  if (v === undefined) {
    if (required) errors.push({ path: key, message: "missing required field" });
    return null;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push({ path: key, message: `expected number, got ${typeof v}` });
    return null;
  }
  return v;
}

function expectBoolean(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
  errors: ValidationError[],
): boolean | null {
  const v = obj[key];
  if (v === undefined) {
    if (required) errors.push({ path: key, message: "missing required field" });
    return null;
  }
  if (typeof v !== "boolean") {
    errors.push({ path: key, message: `expected boolean, got ${typeof v}` });
    return null;
  }
  return v;
}

function requireGlob(key: string, value: string, errors: ValidationError[]): boolean {
  if (value.trim().length === 0) {
    errors.push({ path: key, message: "glob pattern is empty" });
    return false;
  }
  return true;
}

/* ── engine validation ──────────────────────────────────────────── */

const ENGINE_IDS = ["radial", "cycle", "boundary", "anomaly", "convergent"] as const;
type EngineId = (typeof ENGINE_IDS)[number];

/** All 12 EdgeKind values — used to narrow user-supplied strings. */
const EDGE_KINDS = [
  "import",
  "re_export",
  "call",
  "reference",
  "state_read",
  "state_write",
  "event_publish",
  "event_subscribe",
  "test_of",
  "config",
  "unknown_dynamic",
  "external_call",
] as const satisfies readonly import("../graph/types.js").EdgeKind[];

/**
 * Validate that each string in `arr` is a known EdgeKind. Returns the
 * narrowed tuple or null if any value is invalid (errors pushed). The
 * EDGE_KINDS list is the canonical taxonomy from graph/types.ts.
 */
function expectEdgeKindArray(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
  errors: ValidationError[],
): readonly import("../graph/types.js").EdgeKind[] | null {
  const raw = obj[key];
  if (raw === undefined) {
    if (required) {
      errors.push({ path: key, message: "is required" });
    }
    return null;
  }
  if (!Array.isArray(raw)) {
    errors.push({ path: key, message: `expected array of edge kinds, got ${typeof raw}` });
    return null;
  }
  const out: import("../graph/types.js").EdgeKind[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== "string") {
      errors.push({ path: `${key}[${i}]`, message: `expected string, got ${typeof v}` });
      continue;
    }
    if ((EDGE_KINDS as readonly string[]).includes(v)) {
      out.push(v as import("../graph/types.js").EdgeKind);
    } else {
      errors.push({
        path: `${key}[${i}]`,
        message: `unknown edge kind "${v}"; must be one of: ${EDGE_KINDS.join(", ")}`,
      });
    }
  }
  return out;
}

function validateEngineConfig(
  name: EngineId,
  raw: unknown,
  errors: ValidationError[],
): { enabled: boolean; max_depth?: number; max_nodes?: number; allowed_edge_kinds?: readonly import("../graph/types.js").EdgeKind[] } | null {
  // Undefined: user omitted this engine. Fall back to DEFAULT_CONFIG.<name>
  // (which has enabled: true and sensible per-engine knobs).
  if (raw === undefined) {
    return DEFAULT_CONFIG.engines[name];
  }
  if (!isObject(raw)) {
    errors.push({ path: `engines.${name}`, message: `expected object, got ${typeof raw}` });
    return null;
  }
  // User provided {} (empty object) — same as undefined: use defaults.
  // (The "if (!isObject(raw))" check above returned for the non-object
  // case; here we have an object but it might be empty.)
  const enabled = expectBoolean(raw, "enabled", true, errors);
  const max_depth = expectNumber(raw, "max_depth", false, errors);
  const max_nodes = expectNumber(raw, "max_nodes", false, errors);
  const allowed_edge_kinds = expectEdgeKindArray(raw, "allowed_edge_kinds", false, errors);

  if (max_depth !== null && (max_depth < 0 || !Number.isInteger(max_depth))) {
    errors.push({ path: `engines.${name}.max_depth`, message: "must be a non-negative integer" });
  }
  if (max_nodes !== null && (max_nodes < 0 || !Number.isInteger(max_nodes))) {
    errors.push({ path: `engines.${name}.max_nodes`, message: "must be a non-negative integer" });
  }
  if (enabled === null) return null;
  return { enabled, max_depth: max_depth ?? undefined, max_nodes: max_nodes ?? undefined, allowed_edge_kinds: allowed_edge_kinds ?? undefined };
}

function validateEngines(raw: unknown, errors: ValidationError[]): EnginesConfig | null {
  if (!isObject(raw)) {
    errors.push({ path: "engines", message: `expected object, got ${typeof raw}` });
    return null;
  }
  // Each engine is independently optional. Missing engines fall back
  // to DEFAULT_CONFIG.<engine>. This mirrors the scoring/report fix:
  // users can now provide a partial config (e.g. only `radial: { enabled: false }`
  // to disable a noisy engine) and the rest of the engines stay at
  // their sensible defaults.
  const result: Partial<EnginesConfig> = {};
  for (const id of ENGINE_IDS) {
    // Pass `raw[id]` as-is. If it's undefined, validateEngineConfig
    // returns `{ enabled: true, ...defaults }`.
    const v = validateEngineConfig(id, raw[id], errors);
    if (v) result[id] = v as EnginesConfig[typeof id];
  }
  // All 5 engine slots must be filled (either user-provided or
  // default). If any are missing, we have a bug — engine IDs are
  // hard-coded so the loop always produces one entry.
  if (Object.keys(result).length !== ENGINE_IDS.length) return null;
  return result as EnginesConfig;
}

/* ── boundaries validation ──────────────────────────────────────── */

function validateBoundaryCrossing(
  raw: unknown,
  errors: ValidationError[],
): BoundaryCrossing | null {
  if (!isObject(raw)) {
    errors.push({ path: "boundaries.forbidden_crossings[]", message: "expected object" });
    return null;
  }
  const from = expectString(raw, "from", true, errors);
  const to = expectString(raw, "to", true, errors);
  const severity = expectString(raw, "severity", true, errors);
  const reason = expectString(raw, "reason", true, errors);

  const validSeverities = new Set(["low", "medium", "high", "critical"]);
  if (severity !== null && !validSeverities.has(severity)) {
    errors.push({
      path: "boundaries.forbidden_crossings[].severity",
      message: `must be one of low|medium|high|critical (got ${JSON.stringify(severity)})`,
    });
  }
  if (!from || !to || !severity || !reason) return null;
  return { from, to, severity: severity as BoundaryCrossing["severity"], reason };
}

function validateBoundaries(
  raw: unknown,
  errors: ValidationError[],
): Config["boundaries"] | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    errors.push({ path: "boundaries", message: `expected object, got ${typeof raw}` });
    return undefined;
  }
  const tagsRaw = expectObject(raw, "tags", errors);
  const tags: Record<string, { globs?: PathPattern[]; symbols?: string[] }> = {};
  if (tagsRaw) {
    for (const [name, t] of Object.entries(tagsRaw)) {
      if (!isObject(t)) {
        errors.push({ path: `boundaries.tags.${name}`, message: "expected object" });
        continue;
      }
      const globs = expectStringArray(t, "globs", false, errors);
      const symbols = expectStringArray(t, "symbols", false, errors);
      tags[name] = { globs: globs ?? undefined, symbols: symbols ?? undefined };
    }
  }
  const crossingsRaw = raw["forbidden_crossings"];
  const forbidden_crossings: BoundaryCrossing[] = [];
  if (crossingsRaw !== undefined) {
    if (!Array.isArray(crossingsRaw)) {
      errors.push({ path: "boundaries.forbidden_crossings", message: "expected array" });
    } else {
      for (const c of crossingsRaw) {
        const parsed = validateBoundaryCrossing(c, errors);
        if (parsed) forbidden_crossings.push(parsed);
      }
      // Validate that referenced tags exist.
      const tagNames = new Set(Object.keys(tags));
      for (const c of forbidden_crossings) {
        if (!tagNames.has(c.from)) {
          errors.push({
            path: `boundaries.forbidden_crossings[].from`,
            message: `references undefined tag '${c.from}'`,
          });
        }
        if (!tagNames.has(c.to)) {
          errors.push({
            path: `boundaries.forbidden_crossings[].to`,
            message: `references undefined tag '${c.to}'`,
          });
        }
      }
    }
  }
  return { tags, forbidden_crossings };
}

/* ── top-level ──────────────────────────────────────────────────── */

export function validateConfig(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: [{ path: "", message: "config must be an object" }] };
  }

  const include = expectStringArray(raw, "include", true, errors);
  const exclude = expectStringArray(raw, "exclude", true, errors);
  const enginesRaw = expectObject(raw, "engines", errors);
  const scoringRaw = expectObject(raw, "scoring", errors);
  const reportRaw = expectObject(raw, "report", errors);

  // Validate glob strings are non-empty.
  if (include) for (const g of include) requireGlob("include[]", g, errors);
  if (exclude) for (const g of exclude) requireGlob("exclude[]", g, errors);

  // generated / tests / sinks (all optional FileSetConfig with required globs).
  const generatedRaw = expectObject(raw, "generated", errors);
  const generated = generatedRaw
    ? (() => {
        const globs = expectStringArray(generatedRaw, "globs", true, errors);
        if (globs) for (const g of globs) requireGlob("generated.globs[]", g, errors);
        return globs ? { globs } : undefined;
      })()
    : undefined;
  const testsRaw = expectObject(raw, "tests", errors);
  const tests = testsRaw
    ? (() => {
        const globs = expectStringArray(testsRaw, "globs", true, errors);
        if (globs) for (const g of globs) requireGlob("tests.globs[]", g, errors);
        return globs ? { globs } : undefined;
      })()
    : undefined;

  const boundaries = validateBoundaries(raw["boundaries"], errors);

  const sinksRaw = expectObject(raw, "sinks", errors);
  const sinks: Config["sinks"] = {};
  if (sinksRaw) {
    for (const [name, s] of Object.entries(sinksRaw)) {
      if (!isObject(s)) {
        errors.push({ path: `sinks.${name}`, message: "expected object" });
        continue;
      }
      const globs = expectStringArray(s, "globs", true, errors);
      if (globs) {
        for (const g of globs) requireGlob(`sinks.${name}.globs[]`, g, errors);
        sinks[name] = { globs };
      }
    }
  }

  const engines = enginesRaw ? validateEngines(enginesRaw, errors) : null;

  // scoring: 8 numeric fields, each independently optional. Missing
  // fields fall back to DEFAULT_CONFIG.scoring[field]. This is the
  // partial-config fix: a user can provide just one bonus knob
  // (e.g. `boundary_bonus: 0.5`) and the rest stay at their defaults.
  let scoring: Config["scoring"] | null = null;
  if (scoringRaw) {
    const keys = [
      "geometry_bonus_per_extra_geometry",
      "independence_bonus_per_extra_independent_method",
      "boundary_bonus",
      "state_bonus",
      "cycle_bonus",
      "test_gap_bonus",
      "contradiction_penalty",
      "capability_gap_penalty",
    ] as const;
    const partial: Record<string, number> = {};
    for (const k of keys) {
      const v = expectNumber(scoringRaw, k, false, errors);
      partial[k] = v ?? DEFAULT_CONFIG.scoring[k];
      }
      scoring = partial as unknown as Config["scoring"];
    }

      // ci (optional).
  const ciRaw = expectObject(raw, "ci", errors);
  let ci: Config["ci"];
  if (ciRaw) {
    const failOnRaw = expectObject(ciRaw, "fail_on", errors);
    if (failOnRaw) {
      const new_critical = expectBoolean(failOnRaw, "new_critical_hypotheses", false, errors);
      const new_boundary = expectBoolean(failOnRaw, "new_forbidden_boundary_crossings", false, errors);
      const parse_rate = expectNumber(failOnRaw, "parse_failure_rate_over", false, errors);
      const new_cycles = expectNumber(failOnRaw, "new_cycles_over", false, errors);
      if (
        (parse_rate !== null && (parse_rate < 0 || parse_rate > 1)) ||
        (new_cycles !== null && new_cycles < 0)
      ) {
        errors.push({ path: "ci.fail_on", message: "numeric thresholds out of range" });
      }
      ci = {
        fail_on: {
          new_critical_hypotheses: new_critical ?? undefined,
          new_forbidden_boundary_crossings: new_boundary ?? undefined,
          parse_failure_rate_over: parse_rate ?? undefined,
          new_cycles_over: new_cycles ?? undefined,
        },
      };
    }
  }

  // report: 2 fields, each independently optional. Missing fields
  // fall back to DEFAULT_CONFIG.report[field]. Mirrors the scoring
  // partial-config fix.
  let report: Config["report"] | null = null;
  if (reportRaw) {
    const top_n = expectNumber(reportRaw, "top_n_hypotheses", false, errors);
    const redact = expectBoolean(reportRaw, "redact", false, errors);
    if (top_n !== null && (!Number.isInteger(top_n) || top_n < 1)) {
      errors.push({ path: "report.top_n_hypotheses", message: "must be a positive integer" });
    }
    report = {
      top_n_hypotheses: top_n ?? DEFAULT_CONFIG.report.top_n_hypotheses,
      redact: redact ?? DEFAULT_CONFIG.report.redact,
    };
  }

  // Aggregate result. include/exclude/engines are required user input;
  // scoring/report have sane defaults in DEFAULT_CONFIG and are applied
  // below when the user omits them. This is the T11+ fix: previously
  // omitting scoring or report caused the validator to return
  // {ok: false, errors: []} (this aggregate check failed but no error
  // was pushed), which surfaced as the cryptic 'Config validation
  // failed (0 errors)' message.
  if (!include || !exclude || !engines) {
    return { ok: false, errors };
  }

  const config: Config = {
    include,
    exclude,
    engines,
    scoring: scoring ?? DEFAULT_CONFIG.scoring,
    report: report ?? DEFAULT_CONFIG.report,
    ...(generated ? { generated } : {}),
    ...(tests ? { tests } : {}),
    ...(boundaries ? { boundaries } : {}),
    ...(sinks ? { sinks } : {}),
    ...(ci ? { ci } : {}),
  };

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config };
}
