/**
 * Default correlation-key derivation paths for workflow event waits.
 *
 * An `event.wait` step can only resume when the incoming event resolves a
 * correlation key equal to the wait's own key expression. Product emitters do
 * not set an explicit `workflow_correlation_key`, so derivation paths are the
 * only production source of event-side keys. These defaults make the common
 * entity identifiers derivable out of the box; the
 * WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON env var, when set and
 * parseable, replaces them entirely.
 */

export const DEFAULT_WORKFLOW_EVENT_CORRELATION_PATHS: Record<string, string[]> = {
  '*': ['ticketId', 'clientId', 'invoiceId', 'projectId', 'paymentId'],
  TICKET_CREATED: ['ticketId'],
  TICKET_UPDATED: ['ticketId'],
  TICKET_CLOSED: ['ticketId'],
  TICKET_COMMENT_ADDED: ['ticketId'],
  TICKET_RESPONSE_STATE_CHANGED: ['ticketId'],
  INVOICE_FINALIZED: ['invoiceId', 'clientId'],
  INVOICE_SENT: ['invoiceId', 'clientId'],
  INVOICE_STATUS_CHANGED: ['invoiceId', 'clientId'],
};

export const WORKFLOW_EVENT_CORRELATION_PATHS_ENV = 'WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON';

export type CorrelationPathsResolution = {
  paths: string[];
  source: 'env' | 'default' | 'none';
};

/**
 * Returns the derivation paths for an event name, event-specific entries
 * first, then wildcard entries. Env config (when present and parseable)
 * replaces the built-in defaults; a set-but-unparseable env value falls back
 * to the defaults rather than silently disabling correlation.
 */
export function getWorkflowEventCorrelationPaths(eventName: string): CorrelationPathsResolution {
  const envConfig = parseEnvCorrelationConfig();
  const config = envConfig ?? DEFAULT_WORKFLOW_EVENT_CORRELATION_PATHS;
  const source: CorrelationPathsResolution['source'] = envConfig ? 'env' : 'default';

  const paths = normalizePathConfig(config[eventName]).concat(normalizePathConfig(config['*']));
  if (paths.length === 0) {
    return { paths: [], source: 'none' };
  }
  return { paths, source };
}

function parseEnvCorrelationConfig(): Record<string, unknown> | null {
  const raw = process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV];
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizePathConfig(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}
