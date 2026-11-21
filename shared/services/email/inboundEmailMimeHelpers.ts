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

/**
 * CP1252 code points for bytes 0x80-0x9F. Senders that double-encode UTF-8 go
 * through CP1252 (not pure Latin-1), so these must map back to their byte.
 */
const CP1252_BYTE_BY_CODE_POINT = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const MAX_MOJIBAKE_REPAIR_PASSES = 2;

/** One repair pass; null when the value is not recoverable mojibake. */
function repairUtf8MojibakePass(value: string): string | null {
  const bytes = new Uint8Array(value.length);
  let sawHighByte = false;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    let byte: number;
    if (codePoint <= 0xff) {
      byte = codePoint;
    } else {
      const mapped = CP1252_BYTE_BY_CODE_POINT.get(codePoint);
      if (mapped === undefined) return null;
      byte = mapped;
    }
    if (byte >= 0x80) sawHighByte = true;
    bytes[index] = byte;
  }

  if (!sawHighByte) return null;

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded === value ? null : decoded;
  } catch {
    return null;
  }
}

/**
 * Repair UTF-8 text that a sender encoded twice ("fÃ¼r" -> "für").
 *
 * Reverses the mis-decode by turning each char back into the byte it stands
 * for and re-decoding strictly as UTF-8; anything that is not a clean
 * round-trip (plain ASCII, real Latin-1 accents, emoji) is returned untouched.
 */
export function repairUtf8Mojibake(value: string): string {
  let repaired = value;
  for (let pass = 0; pass < MAX_MOJIBAKE_REPAIR_PASSES; pass += 1) {
    const next = repairUtf8MojibakePass(repaired);
    if (next === null) break;
    repaired = next;
  }
  return repaired;
}
