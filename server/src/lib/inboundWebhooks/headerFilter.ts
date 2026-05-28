const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);

export type PersistableHeaders = Record<string, string | string[]>;

export function filterInboundWebhookHeaders(headers: Headers | Record<string, string | string[] | undefined>): PersistableHeaders {
  const entries =
    headers instanceof Headers
      ? [...headers.entries()].map(([key, value]) => [key, value] as const)
      : Object.entries(headers);

  const filtered: PersistableHeaders = {};

  for (const [name, value] of entries) {
    if (!value || SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
      continue;
    }

    filtered[name.toLowerCase()] = value;
  }

  return filtered;
}
