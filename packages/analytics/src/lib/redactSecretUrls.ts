/**
 * Links in this product carry credentials in their query string: invitation
 * and password-reset tokens, one-time sign-in codes, OAuth state, and signed
 * storage links (S3 SigV4 `X-Amz-Signature` / `X-Amz-Credential` /
 * `X-Amz-Security-Token`, and the same prefixed form other providers use).
 * Analytics records page URLs, referrers and clicked links, so every such
 * value is replaced before an event leaves the browser.
 */
const SECRET_QUERY_VALUE =
  /([?&](?:[\w.-]*(?:token|signature|credential)|ott|otp|code|state|secret|password|sig|key|api_key)=)[^&#"'\s]*/gi;

const MAX_DEPTH = 12;

export function redactSecretQueryValues(text: string): string {
  return text.replace(SECRET_QUERY_VALUE, '$1redacted');
}

/**
 * Returns a redacted deep copy. Strings are redacted, other leaves pass
 * through untouched. Cycles, excessive depth or exotic shapes throw so the
 * caller can drop the event instead of sending it.
 */
function redactValue(value: unknown, depth: number, ancestors: object[]): unknown {
  if (typeof value === 'string') {
    return value.includes('=') ? redactSecretQueryValues(value) : value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth > MAX_DEPTH || ancestors.includes(value)) {
    throw new Error('unredactable');
  }

  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, nextAncestors));
  }

  if (value instanceof Date) {
    return value;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    // DOM nodes, Dates, class instances: not a shape we can copy faithfully.
    throw new Error('unredactable');
  }

  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = redactValue(item, depth + 1, nextAncestors);
  }
  return copy;
}

const REDACTED_FIELDS = ['properties', '$set', '$set_once'] as const;

/**
 * PostHog `before_send`: covers every event, including automatic pageviews,
 * autocaptured link clicks (`$elements`, `$elements_chain`) and the initial
 * URL stored on the person.
 *
 * Total by design: on any failure the event is dropped (`null`). It never
 * returns the unredacted object and never logs its input.
 */
export function redactCaptureResult<T extends object>(result: T | null): T | null {
  if (!result) return null;
  try {
    const record = result as Record<string, unknown>;
    const out: Record<string, unknown> = { ...record };
    for (const field of REDACTED_FIELDS) {
      if (record[field] !== undefined) {
        out[field] = redactValue(record[field], 0, [result]);
      }
    }
    return out as T;
  } catch {
    return null;
  }
}
