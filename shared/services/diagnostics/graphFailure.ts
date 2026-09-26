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
export function classifyGraphFailure(error: any, context?: { signedInUser?: string; mailbox?: string; requestPath?: string }): GraphFailure {
  const res = error?.response;
  // Already-sanitized errors (e.g. from token refresh inside the request
  // interceptor) carry status/code/responseBody at the top level.
  const status = res?.status ?? error?.status;
  const body = res?.data ?? error?.responseBody;
  const graphErr = body?.error || body;
  let message =
    graphErr?.message ||
    error?.message ||
    (typeof error === 'string' ? error : 'Unknown error');
  const code =
    graphErr?.code || error?.code || (status ? String(status) : undefined);
  const requestPath = context?.requestPath ?? error?.config?.url ?? error?.response?.config?.url ?? '';
  if (status === 404 && /\/users\//i.test(requestPath) &&
      (code === 'ErrorItemNotFound' || /Default folder Root not found/i.test(message))) {
    message = `${context?.signedInUser || 'The signed-in user'} can't open ${context?.mailbox || 'the configured mailbox'}. Make sure it is a shared or user mailbox (not an alias, distribution list or Microsoft 365 Group) and that the account has Full Access or at least read permission on the watched folder. Sending as the mailbox also requires Send As or Send on Behalf; Full Access does not grant it.`;
  }
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
