/**
 * Redaction policy for outbound diagnostics reports and support bundles.
 *
 * Strips secret-bearing fields and (by default) mailbox identifiers while
 * preserving status codes and provider request IDs. This is a formatting
 * policy, not an execution concern.
 */

const SECRET_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refresh_token',
  'refreshtoken',
  'idtoken',
  'id_token',
  'password',
  'apikey',
  'api_key',
  'client_secret',
  'clientsecret',
  'authorization',
  'secret',
  'privatekey',
  'private_key',
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export interface RedactionOptions {
  includeIdentifiers: boolean;
}

function redactString(value: string, options: RedactionOptions): string {
  if (options.includeIdentifiers) return value;
  return value.replace(EMAIL_PATTERN, '[redacted-email]');
}

export function redactDiagnosticsValue(value: unknown, options: RedactionOptions): unknown {
  if (typeof value === 'string') {
    return redactString(value, options);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticsValue(entry, options));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        output[key] = '[redacted]';
        continue;
      }
      output[key] = redactDiagnosticsValue(entry, options);
    }
    return output;
  }
  return value;
}
