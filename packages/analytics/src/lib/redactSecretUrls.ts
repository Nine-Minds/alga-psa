/**
 * Links in this product carry credentials in their query string: invitation
 * and password-reset tokens, one-time sign-in codes, OAuth state. Analytics
 * records page URLs, referrers and clicked links, so every such value is
 * replaced before an event leaves the browser.
 */
const SECRET_QUERY_VALUE = /([?&](?:[\w.-]*token|ott|otp|code|state|secret|password|signature|sig|key|api_key)=)[^&#"'\s]*/gi;

export function redactSecretQueryValues(text: string): string {
  return text.replace(SECRET_QUERY_VALUE, '$1redacted');
}

function redactProperties(properties: Record<string, unknown> | undefined): void {
  if (!properties) return;
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string' && value.includes('=')) properties[key] = redactSecretQueryValues(value);
  }
}

/** PostHog `before_send`: covers every event, including automatic pageviews,
 * autocaptured link clicks and the initial URL stored on the person. */
export function redactCaptureResult<T extends { properties?: Record<string, unknown>; $set?: Record<string, unknown>; $set_once?: Record<string, unknown> }>(
  result: T | null,
): T | null {
  if (!result) return result;
  redactProperties(result.properties);
  redactProperties(result.$set);
  redactProperties(result.$set_once);
  return result;
}
