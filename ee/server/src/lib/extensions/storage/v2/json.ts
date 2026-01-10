import type { JsonValue } from './types';

/**
 * Knex/pg will not automatically JSON-encode plain JS strings when inserting into `jsonb`.
 * Postgres expects valid JSON text, so scalars must be quoted (e.g. `"abc"`).
 */
export function encodeJsonb(value: JsonValue): string {
  return JSON.stringify(value ?? null);
}

