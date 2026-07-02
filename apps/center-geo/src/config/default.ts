/**
 * Default configuration used when no --config is supplied.
 *
 * These defaults intentionally bias toward permissive discovery
 * (broad include globs, all engines enabled) because the scanner is
 * hypothesis-only — false positives cost researcher time, but a
 * missed file means a missed hypothesis entirely. Tighter configs
 * arrive via user config files, not by changing these defaults.
 *
 * The shape is the same as the YAML example in
 * examples/center-geometry.config.yaml from the requirements package;
 * any field added here must also be added to types.ts and validate.ts.
 */

import type { Config } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  include: [
    "src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
    "packages/**/*.{ts,tsx,js,jsx,mjs,cjs}",
    "lib/**/*.{ts,tsx,js,jsx,mjs,cjs}",
  ],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/.cache/**",
    "**/coverage/**",
    "**/.git/**",
    "**/venv/**",
    "**/.venv/**",
    "**/__pycache__/**",
  ],
  generated: {
    globs: ["**/*.generated.ts", "**/__generated__/**"],
  },
  tests: {
    globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.test.tsx",
      "**/*.spec.tsx",
      "**/__tests__/**",
      "**/*.test.js",
      "**/*.spec.js",
    ],
  },
  boundaries: {
    tags: {
      ui: { globs: ["src/ui/**", "src/components/**"] },
      api: { globs: ["src/api/**", "src/routes/**"] },
      persistence: { globs: ["src/db/**", "src/repositories/**"] },
    },
    forbidden_crossings: [],
  },
  engines: {
    radial: {
      enabled: true,
      max_depth: 4,
      max_nodes: 500,
      allowed_edge_kinds: ["import", "call", "reference", "state_write"],
    },
    cycle: {
      enabled: true,
      allowed_edge_kinds: [
        "import",
        "call",
        "reference",
        "state_write",
        "event_publish",
        "event_subscribe",
      ],
    },
    boundary: {
      enabled: true,
    },
    anomaly: {
      enabled: true,
      percentile_threshold: 0.99,
    },
    convergent: {
      enabled: true,
      max_depth: 4,
      min_shared_sinks: 3,
    },
    path: {
      enabled: true,
      max_depth: 8,
      path_count_cap: 25,
      long_path_min_length: 4,
      entry_tags: ["ui", "api"],
      sink_tags: ["persistence"],
      guard_tags: ["api"],
      allowed_edge_kinds: ["call", "import", "unknown_dynamic"],
    },
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
  ci: {
    fail_on: {
      new_critical_hypotheses: true,
      new_forbidden_boundary_crossings: true,
      parse_failure_rate_over: 0.1,
      new_cycles_over: 3,
    },
  },
  report: {
    top_n_hypotheses: 20,
    redact: true,
  },
};
