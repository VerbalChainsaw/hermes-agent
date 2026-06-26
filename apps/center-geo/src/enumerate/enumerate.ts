/**
 * Main file enumerator.
 *
 * Walks the repository tree under `repoRoot`, applies the user's
 * include/exclude globs from `Config`, classifies each match (source /
 * test / generated), computes a SHA-256 content hash for every file,
 * and returns a deterministic sorted list of FileEntry.
 *
 * Determinism guarantees (per T02 acceptance):
 *   1. Same repo state → same file order (sorted by repo-relative POSIX path).
 *   2. Same file order → same enumeration hash.
 *   3. Same content → same content hash (SHA-256, deterministic by spec).
 *
 * Symlink handling: we DO NOT follow symlinks by default. They are listed
 * as entries but their targets are NOT walked, to prevent infinite loops
 * and accidental recursion into /dev or similar. The user can override
 * via config (future ticket).
 *
 * Permission/IO errors on individual files are recorded as warnings,
 * not fatal — the scan continues with whatever files we could read.
 * Only failures that block the entire scan (repo missing, repo unreadable)
 * are fatal.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { buildMatcher, toPosixPath } from "./glob.js";
import { classify } from "./classifier.js";
import type { Config } from "../config/types.js";
import type {
  ContentHash,
  EnumerationOutcome,
  EnumerationResult,
  EnumerationWarning,
  FileEntry,
  FileClassification,
} from "./types.js";

const MAX_FILE_BYTES = 16 * 1024 * 1024; // 16 MB. Larger files are skipped with a warning.
const MAX_FILES_PER_SCAN = 100_000; // Sanity cap. T02-acceptance says "ignores default heavy folders" — this is the second line of defense.

/**
 * Hash the file contents with SHA-256, lowercase hex.
 */
function hashContent(buf: Buffer): ContentHash {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Build the deterministic file id from the repo-relative POSIX path.
 * Format: `file:<posix-path>`. The `file:` prefix scopes the id namespace
 * so symbol/edge ids (T03) cannot collide with file ids.
 */
function fileId(relativePosix: string): string {
  return `file:${relativePosix}`;
}

/**
 * Recursively walk a directory. Returns absolute paths in deterministic
 * order (sorted at each level by basename). Skips symlinks, devices,
 * and FIFOs.
 */
async function walkDir(
  absDir: string,
  include: string[],
  exclude: string[],
  warnings: EnumerationWarning[],
): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push({ path: absDir, message: `readdir failed: ${reason}` });
    return out;
  }
  // Deterministic ordering: sort by basename, case-sensitive. (Mixing
  // case sensitivity across the file system would be a future trap.)
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    if (entry.isSymbolicLink()) {
      // Skip symlinks entirely for now. Future ticket may add
      // `followSymlinks` config option.
      continue;
    }
    if (entry.isDirectory()) {
      // We do NOT pre-filter by include/exclude here. Why? Because a
      // directory might contain a match even if the dir name itself
      // doesn't match, AND a directory's name might be in exclude but
      // a sibling file shouldn't be. Defer to the matcher below.
      const child = await walkDir(abs, include, exclude, warnings);
      out.push(...child);
    } else if (entry.isFile()) {
      out.push(abs);
    }
    // Devices/FIFOs/sockets: silently ignored. They're not source code.
  }
  return out;
}

/**
 * Build a FileEntry from an absolute path + repo root + config.
 * Returns null if the file should be skipped (size cap, hash error, etc.)
 * and pushes a warning in that case.
 */
async function buildEntry(
  absPath: string,
  repoRoot: string,
  config: Config,
  warnings: EnumerationWarning[],
): Promise<FileEntry | null> {
  const rel = relative(repoRoot, absPath);
  const relPosix = toPosixPath(rel);

  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push({ path: relPosix, message: `read failed: ${reason}` });
    return null;
  }

  if (buf.length > MAX_FILE_BYTES) {
    warnings.push({
      path: relPosix,
      message: `skipped: file exceeds ${MAX_FILE_BYTES} bytes (${buf.length})`,
    });
    return null;
  }

  let stats;
  try {
    stats = await stat(absPath);
  } catch {
    // Race: file may have been deleted between readdir and stat.
    // Treat as no metadata; modifiedMs=0 is the documented sentinel.
    stats = { mtimeMs: 0 } as { mtimeMs: number };
  }

  return {
    id: fileId(relPosix),
    relativePath: relPosix,
    absolutePath: absPath,
    contentHash: hashContent(buf),
    size: buf.length,
    modifiedMs: stats.mtimeMs,
    classification: classify(relPosix, config),
  };
}

/**
 * Hash the file id list deterministically (used to fingerprint an
 * enumeration without re-reading the filesystem). Different id lists
 * produce different hashes; same list in different orders produce the
 * SAME hash because we sort before hashing.
 */
function hashFileIds(ids: string[]): string {
  const sorted = [...ids].sort();
  const h = createHash("sha256");
  for (const id of sorted) h.update(id).update("\n");
  return h.digest("hex").slice(0, 16);
}

/**
 * Enumerate a repository under `repoRoot` per the user's `config`.
 *
 * Returns an `EnumerationOutcome` (success or one of the failure codes).
 * Never throws on filesystem errors — only on programming bugs.
 */
export async function enumerateFiles(
  repoRoot: string,
  config: Config,
): Promise<EnumerationOutcome> {
  const start = performance.now();
  const absRoot = isAbsolute(repoRoot) ? repoRoot : resolve(process.cwd(), repoRoot);

  // Repo must exist and be a directory.
  let rootStat;
  try {
    rootStat = await stat(absRoot);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "repo_not_found",
      message: `Repository root not accessible at ${absRoot}: ${reason}`,
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      ok: false,
      code: "repo_read_error",
      message: `Repository root ${absRoot} is not a directory`,
    };
  }

  const warnings: EnumerationWarning[] = [];
  const matcher = buildMatcher(config.include, config.exclude);

  // Walk from the repo root. The matcher runs on the repo-relative
  // POSIX path so the same source tree yields the same matches regardless
  // of where the user invoked from.
  const allAbs = await walkDir(absRoot, config.include, config.exclude, warnings);

  // Build entries in parallel for throughput, then sort by id.
  const candidates = allAbs
    .map((abs) => toPosixPath(relative(absRoot, abs)))
    .filter((rel) => matcher(rel))
    .sort();

  if (candidates.length === 0) {
    return {
      ok: false,
      code: "no_files_matched",
      message: `No files matched include globs ${JSON.stringify(config.include)} (after excluding ${JSON.stringify(config.exclude)})`,
    };
  }

  if (candidates.length > MAX_FILES_PER_SCAN) {
    return {
      ok: false,
      code: "no_files_matched",
      message:
        `Enumeration cap exceeded: ${candidates.length} files matched ` +
        `(max ${MAX_FILES_PER_SCAN}). Tighten exclude globs.`,
    };
  }

  const entries: FileEntry[] = [];
  for (const rel of candidates) {
    const abs = join(absRoot, rel.split("/").join(sep));
    const entry = await buildEntry(abs, absRoot, config, warnings);
    if (entry) entries.push(entry);
  }

  // Final sort by id for full determinism (the candidates list was
  // already sorted, but buildEntry can drop files, so re-sort).
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Counts by classification.
  const counts: Record<FileClassification, number> = {
    source: 0,
    test: 0,
    generated: 0,
    excluded: 0,
  };
  for (const e of entries) counts[e.classification]++;

  const result: EnumerationResult = {
    ok: true,
    repoRoot: absRoot,
    files: entries,
    warnings,
    hash: hashFileIds(entries.map((e) => e.id)),
    durationMs: performance.now() - start,
    counts,
  };
  return result;
}
