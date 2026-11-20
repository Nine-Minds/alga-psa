import { createHash } from 'node:crypto';

/**
 * `JSON.stringify` with object keys sorted at every depth. It is the same serialization JSON would produce for the same value
 * (the replacer runs after `toJSON`, so a Date is its ISO string; `undefined` keys are dropped), minus key order. Key order is not
 * stable across a jsonb round-trip, so any digest of a value that can be read back from jsonb must go through this.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item) ?? 'null';
}

/** Hex SHA-256 of the canonical JSON of `value`. */
export const canonicalHash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
