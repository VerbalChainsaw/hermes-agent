/**
 * Deterministic graph node + edge id generators.
 *
 * Per T03 acceptance: "same input emits same IDs; multiedges are
 * preserved". The generator functions are PURE — given the same
 * arguments they produce the same id, across runs, across machines.
 *
 * ID format:
 *   - Node: `<kind>:<16-hex-sha256>` — e.g. `file:3531ab9d6a6a3b39`
 *   - Edge: `e:<16-hex-sha256>`     — e.g. `e:5b6c7d8e9f0a1b2c`
 *
 * The hex prefix is the first 64 bits of SHA-256 over a
 * newline-separated, canonical-form input. SHA-256 first 64 bits
 * gives ~10^19 unique values before collision risk; for a single
 * repo (10k files, 100k edges) that's effectively zero collision risk.
 *
 * Why opaque (not human-readable)?
 *   - Robust to file renames, content moves, etc. The id is stable as
 *     long as the input signature is stable. Renaming a symbol changes
 *     its id (correctly — diff will show the old id disappears and a
 *     new one appears).
 *   - No special characters that break shell, JSON, or graph formats.
 *   - Short enough to log in dense reports.
 *
 * Why SHA-256 (not FNV-1a like config hash)?
 *   - Crypto-strength is overkill for in-repo ids, but: (a) Node's
 *     crypto module is fast and built-in, (b) graph ids are likely
 *     stored in many places (cache files, snapshots, diff logs) and
 *     collision resistance matters more here than for the 1KB config.
 *     If we ever ship a non-crypto alternative, this is a good place.
 */

import { createHash } from "node:crypto";

import type { EdgeKind, NodeKind, SourceRange } from "./types.js";

/**
 * Produce a canonical newline-separated signature string. Internal
 * helper; not exported.
 *
 * Rule: every input is a string segment, joined by `\n`. We DO NOT
 * include a separator inside any segment; the responsibility is on the
 * caller to provide pre-canonicalized strings (sorted keys, normalized
 * paths, etc.).
 */
function sig(...parts: string[]): string {
  return parts.join("\n");
}

function sha256hex16(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/* ── node ids ──────────────────────────────────────────────────── */

/**
 * Generate a node id.
 *
 * Inputs:
 *   - kind: the node's kind (file, function, class, ...).
 *   - path: repo-relative POSIX path. Required for any kind that
 *     corresponds to a specific file location; optional for kinds
 *     like "external" or "unknown".
 *   - symbol: the symbol name within the file (empty for kind=file).
 *
 * Two nodes with identical (kind, path, symbol) get the same id.
 * Two nodes with different symbol get different ids. Renaming a file
 * changes its id — the diff (T24) detects this correctly.
 */
export function makeNodeId(
  kind: NodeKind,
  path: string | undefined,
  symbol: string,
): string {
  const id = sha256hex16(sig(kind, path ?? "", symbol));
  return `${kind}:${id}`;
}

/**
 * Convenience for the most common case: a file node from a
 * FileEntry's id. Re-exported as `fileNodeId` for clarity at call sites.
 */
export function fileNodeId(fileId: string): string {
  // fileId is already deterministic from the enumerator (path-based).
  // We just prefix it with the node kind namespace.
  // Strip the leading "file:" prefix if present, then re-prefix with
  // our own format. This lets callers pass either a FileEntry.id or a
  // raw path.
  const raw = fileId.startsWith("file:") ? fileId.slice(5) : fileId;
  const id = sha256hex16(sig("file", raw));
  return `file:${id}`;
}

/* ── edge ids ──────────────────────────────────────────────────── */

/**
 * Generate an edge id.
 *
 * Inputs:
 *   - from, to: node ids (use makeNodeId for the node ids first).
 *   - kind: edge kind.
 *   - anchors: at least one evidence anchor. Two edges with identical
 *     (from, to, kind) but different anchors get different ids — that
 *     preserves the multigraph (the same import can appear at two
 *     different source locations, and we want to track both).
 *   - anchorKeyForSort: optional field for stable secondary sort when
 *     an edge has no anchors (e.g. config-derived edges).
 */
export interface EdgeIdInput {
  from: string;
  to: string;
  kind: EdgeKind;
  /**
   * Sorted list of anchor signatures (path + range + symbol). The
   * caller is responsible for sorting; we sort lexicographically
   * inside makeEdgeId as a defense in depth.
   */
  anchors: AnchorSignature[];
  /** Optional tiebreaker for edges with no anchors. */
  configKey?: string;
}

export interface AnchorSignature {
  path: string;
  range?: SourceRange;
  symbol?: string;
}

function anchorSig(a: AnchorSignature): string {
  const r = a.range;
  const rangeStr = r
    ? `${r.start_line}:${r.start_col ?? ""}-${r.end_line}:${r.end_col ?? ""}`
    : "";
  return `${a.path}|${rangeStr}|${a.symbol ?? ""}`;
}

export function makeEdgeId(input: EdgeIdInput): string {
  const sortedAnchors = [...input.anchors].sort((a, b) =>
    anchorSig(a) < anchorSig(b) ? -1 : anchorSig(a) > anchorSig(b) ? 1 : 0,
  );
  const id = sha256hex16(
    sig(
      input.from,
      input.to,
      input.kind,
      ...sortedAnchors.map(anchorSig),
      input.configKey ?? "",
    ),
  );
  return `e:${id}`;
}

/**
 * Canonical-form normalization for an id, in case a future caller
 * passes a node id that was generated with a slightly different
 * scheme. Right now it's a pass-through; the function exists so
 * future callers have a stable hook to normalize through.
 */
export function normalizeId(id: string): string {
  return id;
}
