/**
 * Small shared helpers for parsing inbound MIME. New durable-path code uses
 * these instead of the historical per-file duplicates.
 */

/**
 * Extract a normalized list of RFC message ids from a references / in-reply-to
 * value (string or array), preserving surrounding angle brackets.
 */
export function extractMessageIds(value: unknown): string[] {
  const entries: string[] = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const normalized = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const matches = trimmed.match(/<[^<>]+>/g);
    if (matches?.length) {
      for (const match of matches) {
        const cleaned = match.trim();
        if (cleaned.length > 2) normalized.add(cleaned);
      }
      continue;
    }
    if (trimmed.length > 2) normalized.add(trimmed);
  }
  return Array.from(normalized);
}

export interface DerivedReplyIdentity {
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
}

/** A header map (Microsoft/IMAP parsed shape) or a name/value list (Gmail payload.headers, Graph internetMessageHeaders). */
export type InboundHeaderSource =
  | Record<string, unknown>
  | ReadonlyArray<{ name?: string | null; value?: unknown } | null | undefined>;

/** Every value of a header, case-insensitively, from either header shape, in source order. */
export function readHeaderValues(headers: InboundHeaderSource | null | undefined, name: string): unknown[] {
  if (!headers) return [];
  const wanted = name.toLowerCase();
  const entries: Array<[unknown, unknown]> = Array.isArray(headers)
    ? headers.map((h) => [h?.name, h?.value])
    : Object.entries(headers);
  const values: unknown[] = [];
  for (const [key, value] of entries) {
    if (typeof key === 'string' && key.toLowerCase() === wanted) {
      if (Array.isArray(value)) values.push(...value);
      else values.push(value);
    }
  }
  return values;
}

/**
 * The one derivation of inReplyTo / references / threadId for every inbound
 * provider (Gmail, Microsoft, IMAP and the staged-MIME path). Providers differ
 * only in what they pass in:
 *  - `headers`: either header shape, any casing; values may be strings or arrays.
 *  - `conversationId`: the provider's own conversation id (Gmail API threadId,
 *    Microsoft conversationId).
 *
 * Rules:
 *  - inReplyTo: the first `<msg-id>` token of In-Reply-To (display noise dropped).
 *  - references: References tokens in order, deduplicated, with inReplyTo
 *    appended when the header omits it (RFC 5322 puts the parent last).
 *  - threadId: conversationId when present, else the root of the references chain.
 * Absent values are omitted (never "" ), because the event and workflow schemas
 * declare these fields `.optional()` and reject null.
 *
 * These values are sender-controlled: never use them as message identity or
 * dedupe keys.
 */
export function deriveReplyIdentity(params: {
  headers?: InboundHeaderSource | null;
  conversationId?: string | null;
}): DerivedReplyIdentity {
  const inReplyTo = extractMessageIds(readHeaderValues(params.headers, 'in-reply-to'))[0];
  const references = extractMessageIds(readHeaderValues(params.headers, 'references'));
  if (inReplyTo && !references.includes(inReplyTo)) references.push(inReplyTo);

  const conversationId =
    typeof params.conversationId === 'string' && params.conversationId.trim()
      ? params.conversationId.trim()
      : undefined;
  const threadId = conversationId ?? references[0];

  return {
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references.length ? { references } : {}),
    ...(threadId ? { threadId } : {}),
  };
}
