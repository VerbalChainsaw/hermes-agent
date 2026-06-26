/**
 * Glob matcher built on picomatch.
 *
 * picomatch is the standard JS glob library: ~10KB, no transitive deps,
 * handles **, *, {a,b}, !negation, extglob (? +(a,b)), and POSIX vs
 * Windows path conventions.
 *
 * We use it for two distinct jobs:
 *   1. Match a single absolute path against a list of patterns.
 *   2. Walk a directory tree and filter paths in one pass.
 *
 * For (1) we use picomatch.isMatch() with `dot: true` so leading-dot
 * files are NOT silently excluded.
 *
 * For (2) we use a manual walker (Node's fs.readdirSync recursive would
 * be tempting but doesn't give us per-file classification hooks we
 * need; we want to walk in deterministic order).
 */

import picomatch from "picomatch";
import { sep } from "node:path";

/**
 * Normalize a path to forward-slash form for glob matching. picomatch
 * expects POSIX separators regardless of platform, so any backslash
 * (Windows) or mixed-separator path must be normalized first.
 */
export function toPosixPath(p: string): string {
  // On Windows sep is '\\'. Replace both sep and any stray '/'. Also
  // strip Windows drive-letter prefixes — picomatch matches against the
  // path components, not the prefix.
  let s = p.replace(/\\/g, "/");
  if (sep === "\\" && /^[A-Za-z]:\//.test(s)) {
    s = s.slice(2); // drop "C:" / "D:" etc.
  }
  return s;
}

/**
 * Build a matcher that returns true if a path matches ANY of the
 * include patterns AND NONE of the exclude patterns. Patterns are
 * picomatch globs applied to the posix-normalized, relative-from-repo
 * path. Leading-dot files are included if a pattern matches them.
 *
 * Note: picomatch 4.x doesn't expose a public Matcher factory in this
 * build (the `matcher` and `Matcher` statics are undefined), so we call
 * `picomatch.isMatch` per file. picomatch internally caches regex
 * compilation per pattern, so this is O(files × patterns) at the JS level
 * but the regex compilation is amortized.
 */
export function buildMatcher(include: string[], exclude: string[]): (relPosix: string) => boolean {
  if (include.length === 0) {
    // No include patterns = include nothing. Matches "empty array of
    // include globs" the spec allows.
    return () => false;
  }
  return (relPosix: string): boolean => {
    if (!picomatch.isMatch(relPosix, include, { dot: true })) return false;
    if (exclude.length > 0 && picomatch.isMatch(relPosix, exclude, { dot: true })) {
      return false;
    }
    return true;
  };
}

/**
 * Check if a path matches any of the given patterns. Convenience
 * wrapper around picomatch.isMatch with the same options as buildMatcher.
 */
export function matchesAny(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return picomatch.isMatch(path, patterns, { dot: true });
}
