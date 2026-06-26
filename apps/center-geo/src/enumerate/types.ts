/**
 * File enumeration types.
 *
 * The enumerator walks a repository root, matches files against the
 * configured include globs (minus exclude globs), and emits a sorted,
 * deduplicated list of FileEntry. Each entry has a stable id derived
 * from its repo-relative POSIX path so the rest of the graph pipeline
 * can reference files without ambiguity.
 */

/**
 * How a file was classified relative to the user config. Used by
 * downstream stages (T05-T07) to decide parsing strategy:
 * - "source": regular project source — parse for imports/exports/symbols.
 * - "test": test file — still parseable, but flagged so fusion can apply
 *   test_gap_bonus correctly.
 * - "generated": auto-generated, parse best-effort but flag as low-confidence.
 * - "excluded": not selected by the include/exclude rules. Emitted only
 *   when the caller asks for diagnostics (not the default path).
 */
export type FileClassification =
  | "source"
  | "test"
  | "generated"
  | "excluded";

/**
 * Hash of the file contents at enumeration time. Stable for the same
 * file content. Used by graph diff (T24) to detect changed files
 * between scans.
 *
 * Algorithm: SHA-256 of the file bytes, lowercase hex. SHA-256 is
 * overkill for collision-detection within a single repo (a non-crypto
 * hash would suffice) but Node's crypto module is fast and we already
 * use the modern Web Crypto API in places. Keep crypto-grade.
 */
export type ContentHash = string;

export interface FileEntry {
  /**
   * Stable id derived from the repo-relative POSIX path. Format:
   * `file:<path>` — the `file:` prefix scopes the id namespace so node
   * ids never collide with symbol/edge ids (T03).
   *
   * Examples:
   *   file:src/cli/main.ts
   *   file:packages/shared/src/index.ts
   */
  id: string;
  /**
   * Repo-relative path with POSIX separators (forward slashes). Used
   * for graph output and report anchors. The OS-native absolute path is
   * kept in `absolutePath` for actual file reads.
   */
  relativePath: string;
  /** OS-native absolute path. */
  absolutePath: string;
  /** SHA-256 of the file contents at enumeration time. */
  contentHash: ContentHash;
  /** Bytes (after encoding). */
  size: number;
  /** Last-modified timestamp (ms since epoch). 0 if unavailable. */
  modifiedMs: number;
  /** Classification result (see FileClassification). */
  classification: FileClassification;
}

export interface EnumerationWarning {
  /** Dotted path / glob identifier (e.g. "include[2]"). */
  path: string;
  message: string;
}

export interface EnumerationResult {
  ok: true;
  repoRoot: string;
  files: FileEntry[];
  warnings: EnumerationWarning[];
  /** Deterministic hash of the sorted file id list (config-relative). */
  hash: string;
  /** Wall-clock ms spent enumerating. */
  durationMs: number;
  /** Counts by classification. */
  counts: Record<FileClassification, number>;
}

export interface EnumerationFailure {
  ok: false;
  code: "repo_not_found" | "repo_read_error" | "no_files_matched";
  message: string;
}

export type EnumerationOutcome = EnumerationResult | EnumerationFailure;
