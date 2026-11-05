import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Stable digest across JSONB round trips; binds all mapped fields and original MIME bytes when present. */
export function inboundMessageSha256(message: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(message)) ?? 'null').digest('hex');
}
