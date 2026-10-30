const REDACTED = '[redacted]';

/** Keys that always carry a signed URL or file bytes. */
const ALWAYS_SENSITIVE = new Set(['download_url', 'content_base64']);

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

function redactString(value: string, inCarrier: boolean): string {
  return isSignedUrl(value) || (inCarrier && isLargeBase64(value)) ? REDACTED : value;
}

function redactCarrier(value: unknown): unknown {
  if (typeof value !== 'string') return redactValue(value, true);
  try {
    return redactValue(JSON.parse(value), true);
  } catch {
    return REDACTED;
  }
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
    if (ALWAYS_SENSITIVE.has(key) || key === sourceKey) out[key] = REDACTED;
    else if (CARRIER_KEYS.has(key)) out[key] = redactCarrier(inner);
    else out[key] = redactValue(inner, inCarrier);
  }
  return out;
}

/**
 * Copy of tool arguments that is safe to log or audit. One recursive walk:
 * - by key: `download_url`, `content_base64`, and the documents `source` shape
 *   (`type:'url'` -> `url`, `type:'base64'` -> `content`) are replaced;
 *   `attach_file`'s top-level `url` is replaced too (callers pass presigned links);
 * - by shape, anywhere: strings that are URLs carrying signing query params
 *   (AWS SigV4, `sig`, `token`, Azure SAS, ...; names matched case-insensitively);
 * - request-payload carriers (`body`, `data`, `payload`, `file`, `arguments`, at any
 *   depth): a string value is JSON-parsed and stored as the redacted structure, or as
 *   '[redacted]' if it is not JSON; inside carriers, base64-only strings of 512+
 *   chars are replaced.
 * Other strings (titles, unsigned URLs) pass through unchanged.
 */
export function redactToolArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(args) as Record<string, unknown>;
  if (toolName === 'attach_file' && typeof redacted.url === 'string') redacted.url = REDACTED;
  return redacted;
}
