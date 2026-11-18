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

/**
 * The one derivation of inReplyTo / references / threadId for every inbound
 * provider. Providers differ only in what they pass in:
 *  - `headers`: a header map (any casing; values may be strings or arrays).
 *  - `conversationId`: the provider's own conversation id (Gmail API threadId,
 *    Microsoft conversationId). When absent, threadId falls back to
 *    `references[0] || inReplyTo` (the IMAP rule).
 *
 * These values are sender-controlled: never use them as message identity or
 * dedupe keys.
 */
export function deriveReplyIdentity(params: {
  headers?: Record<string, unknown> | null;
  conversationId?: string | null;
}): DerivedReplyIdentity {
  const lookup = (name: string): unknown => {
    const headers = params.headers;
    if (!headers) return undefined;
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === wanted) return headers[key];
    }
    return undefined;
  };

  const references = extractMessageIds(lookup('references'));
  const inReplyTo = extractMessageIds(lookup('in-reply-to'))[0];
  const conversationId =
    typeof params.conversationId === 'string' && params.conversationId.trim()
      ? params.conversationId
      : undefined;
  const threadId = conversationId ?? (references[0] || inReplyTo);

  return {
    inReplyTo: inReplyTo || undefined,
    references: references.length ? references : undefined,
    threadId: threadId || undefined,
  };
}
