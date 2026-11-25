/**
 * Builds the downstream header bag (`EmailMessageDetails.headers`) from a
 * mailparser `ParsedMail.headers` map. Shared by every path that parses raw
 * MIME (the V1 queue job and the durable staged-source path) so the
 * sender-authentication gate sees the same wire headers on both.
 *
 * - Names are lower-cased.
 * - Repeated headers (Authentication-Results, ARC-*) keep every value, joined
 *   with "\n" in wire order: the first block is the receiving MTA's topmost one.
 * - Structured values mailparser decodes into objects (From, To, Date, ...) are
 *   skipped; those travel on their own EmailMessageDetails fields.
 * - `x-resolved-*` / `x-list-*` are processor metadata, never wire data, and are
 *   dropped here; only a verified list-rewrite resolution may add them.
 */
export function collectWireHeaders(parsedHeaders: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  const map = parsedHeaders as { forEach?: (cb: (value: unknown, key: string) => void) => void } | null | undefined;
  if (!map || typeof map.forEach !== 'function') return headers;

  map.forEach((value: unknown, key: string) => {
    const headerName = key.toLowerCase();
    if (headerName.startsWith('x-resolved-') || headerName.startsWith('x-list-')) {
      return;
    }
    if (typeof value === 'string') {
      headers[headerName] = value;
    } else if (Array.isArray(value)) {
      headers[headerName] = value.filter((item): item is string => typeof item === 'string').join('\n');
    }
  });
  return headers;
}
