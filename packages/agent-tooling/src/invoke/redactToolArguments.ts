const REDACTED = '[redacted]';

/** Keys (lower-case; matched case-insensitively) that always carry a signed URL, file bytes, or a credential. */
const ALWAYS_SENSITIVE = new Set([
  'download_url',
  'content_base64',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]);

/** A string that is an HTTP credential (`Bearer ...` / `Basic ...`), under any key. */
const CREDENTIAL_VALUE = /^(?:bearer|basic) /i;

/** URL tokens embedded in free text. */
const URL_TOKEN = /https?:\/\/[^\s"'<>]+/g;
const URL_TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Max JSON.parse layers unwrapped from a carrier string; deeper nesting is redacted. */
const MAX_CARRIER_PARSE_DEPTH = 4;

/** Keys whose values are request payloads (a string value may be a serialized body). */
const CARRIER_KEYS = new Set(['body', 'data', 'payload', 'file', 'arguments']);

/** Query parameters that mark a URL as signed/credentialed (lower-case). */
const SIGNING_PARAMS = ['x-amz-signature', 'x-amz-credential', 'signature', 'sig', 'token', 'access_token'];

/** An Azure SAS query: `sv` plus a resource/identity/permission marker. */
const SAS_COMPANIONS = ['sr', 'skoid', 'sig', 'ss', 'srt'];

const BASE64_MIN_LENGTH = 512;
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

function isSignedUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const names = new Set([...url.searchParams.keys()].map((k) => k.toLowerCase()));
  return SIGNING_PARAMS.some((p) => names.has(p)) || (names.has('sv') && SAS_COMPANIONS.some((p) => names.has(p)));
}

function isLargeBase64(value: string): boolean {
  return value.length >= BASE64_MIN_LENGTH && BASE64_PATTERN.test(value);
}

/** Replace each signed URL token inside `value`, keeping surrounding text and trailing punctuation. */
function redactEmbeddedSignedUrls(value: string): string {
  return value.replace(URL_TOKEN, (match) => {
    const trailing = URL_TRAILING_PUNCTUATION.exec(match)?.[0] ?? '';
    const candidate = match.slice(0, match.length - trailing.length);
    // JSON-escaped / HTML-escaped ampersands hide query separators from URL parsing.
    const normalized = candidate.replace(/\\u0026/gi, '&').replace(/&amp;/gi, '&');
    return isSignedUrl(normalized) ? REDACTED + trailing : match;
  });
}

function redactString(value: string, inCarrier: boolean): string {
  if (CREDENTIAL_VALUE.test(value) || (inCarrier && isLargeBase64(value))) return REDACTED;
  return redactEmbeddedSignedUrls(value);
}

/**
 * Unwrap a serialized carrier by repeated JSON.parse (bodies are sometimes encoded more than once).
 * A value that is still a string after parsing (a JSON string primitive, or too deeply nested) is
 * not structure we can inspect, so it is redacted.
 */
function redactCarrier(value: unknown): unknown {
  let current = value;
  for (let depth = 0; typeof current === 'string'; depth++) {
    if (depth >= MAX_CARRIER_PARSE_DEPTH) return REDACTED;
    try {
      current = JSON.parse(current);
    } catch {
      return REDACTED;
    }
  }
  return redactValue(current, true);
}

function redactValue(value: unknown, inCarrier = false): unknown {
  if (typeof value === 'string') return redactString(value, inCarrier);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, inCarrier));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // The `source` shape of POST /api/v1/documents: { type: 'url', url } | { type: 'base64', content }.
  const sourceKey = record.type === 'url' ? 'url' : record.type === 'base64' ? 'content' : null;
  for (const [key, inner] of Object.entries(record)) {
    if (ALWAYS_SENSITIVE.has(key.toLowerCase()) || key === sourceKey) out[key] = REDACTED;
    else if (CARRIER_KEYS.has(key)) out[key] = redactCarrier(inner);
    else out[key] = redactValue(inner, inCarrier);
  }
  return out;
}

/**
 * Copy of tool arguments that is safe to log or audit. One recursive walk:
 * - by key (case-insensitive): `download_url`, `content_base64`, credential headers
 *   (`authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`), and the documents `source` shape
 *   (`type:'url'` -> `url`, `type:'base64'` -> `content`) are replaced;
 *   `attach_file`'s top-level `url` is replaced too (callers pass presigned links);
 * - by shape, anywhere: strings starting with `Bearer ` / `Basic ` (any case) are replaced;
 *   URLs carrying signing query params (AWS SigV4, `sig`, `token`, Azure SAS, ...; names
 *   matched case-insensitively) are replaced with '[redacted]', including when embedded in
 *   longer text (only the URL is replaced; surrounding text is kept);
 * - request-payload carriers (`body`, `data`, `payload`, `file`, `arguments`, at any
 *   depth): a string value is JSON-parsed (repeatedly, up to MAX_CARRIER_PARSE_DEPTH layers)
 *   and stored as the redacted structure, or as '[redacted]' if it is not JSON, if it
 *   is still a string after parsing, or if the depth cap is hit; inside carriers,
 *   base64-only strings of 512+ chars are replaced.
 * Other strings (titles, unsigned URLs, text around a redacted URL) pass through unchanged.
 */
export function redactToolArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(args) as Record<string, unknown>;
  if (toolName === 'attach_file' && typeof redacted.url === 'string') redacted.url = REDACTED;
  return redacted;
}
