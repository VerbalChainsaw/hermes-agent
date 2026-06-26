/**
 * Deterministic config hash.
 *
 * Per T01 acceptance: "resolved config is deterministic". The hash
 * lets reports and CI gates identify when two scans used identical
 * configs (same hash) vs when one was tweaked (different hash). Uses
 * FNV-1a 64-bit over a JSON-canonicalised view of the config.
 *
 * We hand-roll FNV-1a because Node's crypto module doesn't expose a
 * non-cryptographic hash. FNV-1a is collision-prone for adversarial
 * input, but config values come from a YAML file the user wrote —
 * not adversarial. SHA-256 would be overkill for a 1KB payload.
 */

/** Stable JSON.stringify that sorts object keys recursively. */
export function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalise);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalise(obj[key]);
  }
  return sorted;
}

/** FNV-1a 64-bit hash. Returns an unsigned 64-bit integer as a hex string. */
export function fnv1a64(input: string): string {
  // BigInt gives us reliable 64-bit math without overflow surprises.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Compute a deterministic hash of a config object. Same input → same
 * hash. Two callers with configs that differ only in key order or
 * whitespace produce the same hash (canonical JSON first).
 */
export function hashConfig(config: unknown): string {
  const canonical = JSON.stringify(canonicalise(config));
  return fnv1a64(canonical);
}
