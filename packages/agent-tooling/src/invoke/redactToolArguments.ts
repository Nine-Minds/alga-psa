const REDACTED = '[redacted]';

/** Keys that always carry a signed URL or file bytes. */
const ALWAYS_SENSITIVE = new Set(['download_url', 'content_base64']);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // The `source` shape of POST /api/v1/documents: { type: 'url', url } | { type: 'base64', content }.
  const sourceKey = record.type === 'url' ? 'url' : record.type === 'base64' ? 'content' : null;
  for (const [key, inner] of Object.entries(record)) {
    out[key] = ALWAYS_SENSITIVE.has(key) || key === sourceKey ? REDACTED : redactValue(inner);
  }
  return out;
}

/**
 * Copy of tool arguments that is safe to log or audit: signed download URLs and
 * file contents are replaced. `attach_file`'s top-level `url` is redacted too
 * (callers pass presigned links); `call_api_endpoint` bodies are scrubbed for
 * the documents `source` shape so the REST path cannot leak the same data.
 */
export function redactToolArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(args) as Record<string, unknown>;
  if (toolName === 'attach_file' && typeof redacted.url === 'string') redacted.url = REDACTED;
  return redacted;
}
