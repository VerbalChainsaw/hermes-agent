/**
 * Snapshot helper for report byte-comparison (T22 + Fix #4).
 *
 * Two problems this solves:
 *
 * 1. **Unhelpful diff output.** When a snapshot test fails, the
 *    default vitest diff is a multi-KB raw string diff. For a
 *    100KB JSON snapshot, the diff is unreadable. This helper:
 *      - parses both sides as JSON (for .json and .sarif)
 *      - shows a structural diff: "X new fields, Y changed, Z missing"
 *      - shows the FIRST 3 differences in detail (path + old + new)
 *      - shows file size delta
 *
 * 2. **Volatile fields in golden files.** Some fields are inherently
 *    non-deterministic (timestamps, env-specific paths, tool versions).
 *    Rather than encoding that in every snapshot, this helper
 *    provides a `scrubSnapshot` function that strips known volatile
 *    fields BEFORE comparison. Currently there are no volatile
 *    fields in center-geo's reports (we use static schema_version
 *    "1.0.0" and a `tool_version` derived from package.json), but
 *    future reports may add timestamps.
 *
 * The helper is also a place to centralize the "regenerate goldens"
 * workflow so all snapshot tests can use the same procedure.
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Compare two strings. Returns a structured diff on failure, or
 * null if they match. For JSON inputs, parses both sides and
 * produces a structural diff. For other inputs (Markdown), falls
 * back to a line-by-line diff.
 */
export interface SnapshotDiff {
  kind: "match" | "json-mismatch" | "text-mismatch" | "missing-golden";
  expectedFile: string;
  actualSize: number;
  expectedSize: number;
  sizeDelta: number;
  /** When kind === "json-mismatch": structural summary + first N diffs. */
  structuralSummary?: {
    addedPaths: string[];
    removedPaths: string[];
    changedPaths: Array<{ path: string; from: unknown; to: unknown }>;
  };
  /** When kind === "text-mismatch": first 3 line diffs. */
  lineDiffs?: Array<{ line: number; expected: string; actual: string }>;
}

const STRUCTURAL_SAMPLE_SIZE = 3;

/**
 * Paths in the JSON that are inherently non-deterministic. We scrub
 * these before structural comparison. The "right fix" is to NOT
 * include them in the golden, but we keep them in the report for
 * debugging. Adding a path here means: "we don't care if this
 * value changes between runs."
 */
const VOLATILE_JSON_PATHS = new Set([
  // Coverage timing fields — these depend on actual wall-clock time
  // and CPU scheduling. Two runs on the same fixture produce
  // different values; byte-comparing them would always fail.
  "coverage.parse_ms",
  "coverage.graph_build_ms",
  // Synthetic fixture roots are temporary directories, so the exact
  // path changes across runs even when the scanned content does not.
  "scan_frame.root",
]);

export async function compareSnapshots(
  expectedFile: string,
  actualContent: string,
  options: { isJson?: boolean } = {},
): Promise<SnapshotDiff> {
  let expected: string;
  try {
    expected = await readFile(expectedFile, "utf-8");
  } catch {
    return {
      kind: "missing-golden",
      expectedFile,
      actualSize: actualContent.length,
      expectedSize: 0,
      sizeDelta: actualContent.length,
    };
  }

  // For JSON: always go through the structural diff. The structural
  // diff scrubs volatile fields (timing) so two runs that differ
  // ONLY in those fields still match. Byte-equal is a fast path
  // inside the structural diff (the diff returns match if no paths
  // differ).
  if (options.isJson) {
    const summary = structuralJsonDiff(expected, actualContent);
    const hasChanges =
      summary.addedPaths.length > 0 ||
      summary.removedPaths.length > 0 ||
      summary.changedPaths.length > 0;
    if (hasChanges) {
      return {
        kind: "json-mismatch",
        expectedFile,
        actualSize: actualContent.length,
        expectedSize: expected.length,
        sizeDelta: actualContent.length - expected.length,
        structuralSummary: summary,
      };
    }
    return {
      kind: "match",
      expectedFile,
      actualSize: actualContent.length,
      expectedSize: expected.length,
      sizeDelta: actualContent.length - expected.length,
    };
  }

  // For non-JSON: byte-equal fast path, then line-diff fallback.
  if (expected === actualContent) {
    return {
      kind: "match",
      expectedFile,
      actualSize: actualContent.length,
      expectedSize: expected.length,
      sizeDelta: 0,
    };
  }

  return {
    kind: "text-mismatch",
    expectedFile,
    actualSize: actualContent.length,
    expectedSize: expected.length,
    sizeDelta: actualContent.length - expected.length,
    lineDiffs: firstNLineDiffs(expected, actualContent, STRUCTURAL_SAMPLE_SIZE),
  };
}

interface StructuralJsonDiff {
  addedPaths: string[];
  removedPaths: string[];
  changedPaths: Array<{ path: string; from: unknown; to: unknown }>;
}

function structuralJsonDiff(expected: string, actual: string): StructuralJsonDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ path: string; from: unknown; to: unknown }> = [];

  let expObj: unknown, actObj: unknown;
  try { expObj = JSON.parse(expected); } catch { /* noop */ }
  try { actObj = JSON.parse(actual); } catch { /* noop */ }
  if (expObj === undefined || actObj === undefined) {
    return { addedPaths: ["(unparseable)"], removedPaths: ["(unparseable)"], changedPaths: [] };
  }

  // Scrub volatile paths (timing fields, etc.) by setting both sides
  // to a sentinel value. This keeps the structural diff focused on
  // substantive changes rather than non-deterministic timing.
  scrubVolatile(expObj);
  scrubVolatile(actObj);

  const expKeys = collectPaths(expObj);
  const actKeys = new Set(collectPaths(actObj));
  for (const p of expKeys) {
    if (!actKeys.has(p)) {
      removed.push(p);
    }
  }
  const expSet = new Set(expKeys);
  for (const p of actKeys) {
    if (!expSet.has(p)) {
      added.push(p);
    } else {
      const v1 = getByPath(expObj, p);
      const v2 = getByPath(actObj, p);
      if (JSON.stringify(v1) !== JSON.stringify(v2)) {
        changed.push({ path: p, from: v1, to: v2 });
      }
    }
  }

  return {
    addedPaths: added.slice(0, STRUCTURAL_SAMPLE_SIZE),
    removedPaths: removed.slice(0, STRUCTURAL_SAMPLE_SIZE),
    changedPaths: changed.slice(0, STRUCTURAL_SAMPLE_SIZE),
  };
}

/**
 * Set all VOLATILE_JSON_PATHS to a sentinel. Mutates the object in
 * place. We use a stable sentinel so both expected and actual
 * produce the same string, making the diff see "no change" there.
 */
function scrubVolatile(obj: unknown): void {
  if (obj === null || typeof obj !== "object") return;
  for (const p of VOLATILE_JSON_PATHS) {
    setByPath(obj, p, "<volatile>");
  }
}

function* walkJsonPaths(obj: unknown, prefix: string = ""): Generator<string> {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      yield* walkJsonPaths(obj[i], `${prefix}[${i}]`);
    }
    return;
  }
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    yield path;
    yield* walkJsonPaths((obj as Record<string, unknown>)[k], path);
  }
}

function collectPaths(obj: unknown): string[] {
  return Array.from(walkJsonPaths(obj));
}

function getByPath(obj: unknown, path: string): unknown {
  const parts: Array<string | number> = parsePathParts(path);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts: Array<string | number> = parsePathParts(path);
  if (parts.length === 0) return;
  let cur: Record<string | number, unknown> = obj as Record<string | number, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === null || cur[p] === undefined) return; // can't create
    cur = cur[p] as Record<string | number, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function parsePathParts(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  let buf = "";
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === ".") {
      if (buf) { parts.push(buf); buf = ""; }
    } else if (c === "[") {
      if (buf) { parts.push(buf); buf = ""; }
      const end = path.indexOf("]", i);
      parts.push(parseInt(path.slice(i + 1, end), 10));
      i = end;
    } else {
      buf += c;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

function firstNLineDiffs(expected: string, actual: string, n: number): Array<{ line: number; expected: string; actual: string }> {
  const expLines = expected.split("\n");
  const actLines = actual.split("\n");
  const max = Math.max(expLines.length, actLines.length);
  const out: Array<{ line: number; expected: string; actual: string }> = [];
  for (let i = 0; i < max && out.length < n; i++) {
    if (expLines[i] !== actLines[i]) {
      out.push({
        line: i + 1,
        expected: expLines[i] ?? "(end of file)",
        actual: actLines[i] ?? "(end of file)",
      });
    }
  }
  return out;
}

/**
 * Format a SnapshotDiff for human display. Drops the structured
 * summary to the test runner's output, making snapshot failures
 * 100x more readable than raw string diffs.
 */
export function formatDiff(d: SnapshotDiff): string {
  const lines: string[] = [];
  lines.push(`Snapshot mismatch for ${d.expectedFile}`);
  lines.push(`  size: expected=${d.expectedSize}, actual=${d.actualSize}, delta=${d.sizeDelta}`);
  if (d.kind === "match") {
    lines.push("  (no mismatch — should not be calling this)");
  } else if (d.kind === "missing-golden") {
    lines.push("  golden file is missing. The test runner wrote it on this run.");
    lines.push("  To regenerate, delete the goldens directory and re-run.");
  } else if (d.kind === "json-mismatch" && d.structuralSummary) {
    const s = d.structuralSummary;
    lines.push(`  structural: +${s.addedPaths.length} added, -${s.removedPaths.length} removed, ~${s.changedPaths.length} changed (showing first ${STRUCTURAL_SAMPLE_SIZE})`);
    if (s.addedPaths.length > 0) {
      lines.push("  added: " + s.addedPaths.join(", "));
    }
    if (s.removedPaths.length > 0) {
      lines.push("  removed: " + s.removedPaths.join(", "));
    }
    for (const c of s.changedPaths) {
      lines.push(`  changed: ${c.path}`);
      lines.push(`    from: ${JSON.stringify(c.from)}`);
      lines.push(`    to:   ${JSON.stringify(c.to)}`);
    }
  } else if (d.kind === "text-mismatch" && d.lineDiffs) {
    lines.push(`  text mismatch (showing first ${STRUCTURAL_SAMPLE_SIZE} line diffs):`);
    for (const ld of d.lineDiffs) {
      lines.push(`  line ${ld.line}:`);
      lines.push(`    expected: ${ld.expected}`);
      lines.push(`    actual:   ${ld.actual}`);
    }
  }
  return lines.join("\n");
}

/**
 * Convenience wrapper. Returns null if match, otherwise a formatted
 * diff string. Use in a test like:
 *
 *   const d = await compareSnapshots(GOLDEN, actual, { isJson: true });
 *   if (d.kind !== "match") {
 *     throw new Error(formatDiff(d));
 *   }
 */
export async function assertSnapshot(
  expectedFile: string,
  actualContent: string,
  options: { isJson?: boolean } = {},
): Promise<void> {
  const d = await compareSnapshots(expectedFile, actualContent, options);
  if (d.kind !== "match") {
    throw new Error(formatDiff(d));
  }
}

/**
 * Capture-or-update pattern: if the golden exists, verify; if not,
 * write it. Used by the snapshot tests in test/snapshots.test.ts.
 */
export async function captureOrVerify(
  goldenFile: string,
  actualContent: string,
  options: { isJson?: boolean } = {},
): Promise<"captured" | "verified"> {
  let exists = false;
  try {
    await readFile(goldenFile, "utf-8");
    exists = true;
  } catch { /* missing */ }
  if (!exists) {
    await mkdir(dirnameOf(goldenFile), { recursive: true });
    await writeFile(goldenFile, actualContent, "utf-8");
    return "captured";
  }
  await assertSnapshot(goldenFile, actualContent, options);
  return "verified";
}

function dirnameOf(p: string): string {
  const sep = p.lastIndexOf("/") >= 0 ? "/" : "\\";
  const i = p.lastIndexOf(sep);
  return i >= 0 ? p.slice(0, i) : ".";
}
