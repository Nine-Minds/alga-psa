import type { DiagnosticsErrorMeta } from '@alga-psa/types';

/**
 * Extract the Graph correlation identifiers from a response's headers. Header
 * lookups are case-insensitive so both Axios-normalized and raw casing work.
 */
export function extractGraphIds(headers: any): {
  requestId?: string;
  clientRequestId?: string;
} {
  const lower = (k: string) => headers?.[k] ?? headers?.[k.toLowerCase()];
  return {
    requestId: lower('request-id'),
    clientRequestId: lower('client-request-id'),
  };
}

export interface GraphFailure extends DiagnosticsErrorMeta {
  responseBody?: unknown;
}

/**
 * Classify an arbitrary error thrown by a Graph request or a sanitized Graph
 * error wrapper into safe, redaction-friendly metadata. Never surfaces the raw
 * Axios request/config (which can carry an Authorization header).
 */
export function classifyGraphFailure(error: any): GraphFailure {
  const res = error?.response;
  // Already-sanitized errors (e.g. from token refresh inside the request
  // interceptor) carry status/code/responseBody at the top level.
  const status = res?.status ?? error?.status;
  const body = res?.data ?? error?.responseBody;
  const graphErr = body?.error || body;
  const message =
    graphErr?.message ||
    error?.message ||
    (typeof error === 'string' ? error : 'Unknown error');
  const code =
    graphErr?.code || error?.code || (status ? String(status) : undefined);
  const ids = extractGraphIds(res?.headers);
  return {
    status,
    code,
    message,
    requestId: ids.requestId ?? error?.requestId,
    clientRequestId: ids.clientRequestId ?? error?.clientRequestId,
    responseBody: body,
  };
}
