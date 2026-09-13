/**
 * Shared Microsoft Graph diagnostics helpers.
 *
 * classifyGraphFailure and its request-ID extraction dependency live here so
 * every consumer (inbound M365, outbound email) classifies Graph failures the
 * same way. Recommendation text is composed per consumer: inbound keeps its
 * read/folder advice verbatim, while outbound supplies send-specific advice and
 * never inherits Mail.Read/folder remediation.
 */

import type { DiagnosticsErrorMeta } from '../../interfaces/diagnostics.interfaces';

export interface GraphFailure {
  status?: number;
  code?: string;
  message: string;
  requestId?: string;
  clientRequestId?: string;
  responseBody?: unknown;
}

export function extractGraphIds(headers: any): { requestId?: string; clientRequestId?: string } {
  const lower = (k: string) => headers?.[k] ?? headers?.[k.toLowerCase()];
  return {
    requestId: lower('request-id'),
    clientRequestId: lower('client-request-id'),
  };
}

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
  const code = graphErr?.code || error?.code || (status ? String(status) : undefined);
  const ids = extractGraphIds(res?.headers);
  return {
    status,
    code,
    message,
    requestId: ids.requestId,
    clientRequestId: ids.clientRequestId,
    responseBody: body,
  };
}

export function toDiagnosticsErrorMeta(failure: GraphFailure): DiagnosticsErrorMeta {
  return {
    message: failure.message,
    status: failure.status,
    code: failure.code,
    requestId: failure.requestId,
    clientRequestId: failure.clientRequestId,
    responseBody: failure.responseBody,
  };
}

export interface GraphRecommendationInput {
  status?: number;
  code?: string;
  message: string;
  missingScopes?: string[];
}

/**
 * Inbound Microsoft 365 recommendation mapping, preserved verbatim.
 */
export function mapInboundRecommendations(args: GraphRecommendationInput): string[] {
  const recs: string[] = [];

  if (args.missingScopes?.length) {
    recs.push(
      `Missing delegated scopes in the access token: ${args.missingScopes.join(', ')}. Re-authorize with Mail.Read and Mail.Read.Shared (and ensure admin consent if required).`
    );
  }

  if (args.status === 401) {
    recs.push('Microsoft authorization appears invalid/expired. Re-authorize the Microsoft provider to refresh consent and tokens.');
  }

  if (args.status === 403) {
    recs.push(
      'Microsoft Graph returned 403 (Forbidden). Verify the user has delegated access to the target mailbox/folder and that Mail.Read/Mail.Read.Shared consent was granted.'
    );
  }

  if (args.status === 404) {
    const msg = (args.message || '').toLowerCase();
    if (msg.includes('default folder inbox not found') || msg.includes('specified object was not found in the store')) {
      recs.push(
        'Graph reports the mailbox store/folder is missing. Confirm the address is a real user/shared mailbox (not a group/contact) and that the mailbox is provisioned (can be opened in Outlook/OWA).'
      );
    } else {
      recs.push('Graph returned 404 (Not Found). Verify the mailbox address is correct for this tenant, and the folder exists and is accessible.');
    }
  }

  if (args.status === 429) {
    recs.push('Microsoft Graph throttled the request (429). Wait and retry; consider reducing repeated diagnostics runs.');
  }

  return recs;
}

export interface OutboundGraphRecommendationInput extends GraphRecommendationInput {
  /** True when the configured sending mailbox differs from the authenticated user. */
  sharedMailbox?: boolean;
}

/**
 * Outbound send-specific recommendation mapping. Deliberately does not mention
 * Mail.Read, mailbox folders, or subscription remediation.
 */
export function mapOutboundRecommendations(args: OutboundGraphRecommendationInput): string[] {
  const recs: string[] = [];

  if (args.missingScopes?.length) {
    recs.push(
      `Missing delegated scopes in the access token: ${args.missingScopes.join(', ')}. Reconnect the Microsoft 365 mailbox and grant the required send permissions.`
    );
  }

  if (args.status === 401) {
    recs.push('Microsoft authorization appears invalid/expired. Reconnect the Microsoft 365 mailbox to refresh consent and tokens.');
  }

  if (args.status === 403) {
    recs.push(
      'Microsoft Graph returned 403 (Forbidden). This alone does not identify the missing permission: verify Mail.Send consent and, when sending as a shared/delegated mailbox, Exchange Send As (or Send on Behalf) for the sending identity.'
    );
  }

  if (args.status === 404) {
    recs.push('Graph returned 404 (Not Found). Verify the configured sending mailbox is a real, provisioned user or shared mailbox in this tenant.');
  }

  if (args.status === 429) {
    recs.push('Microsoft Graph throttled the request (429). Wait and retry; avoid repeated live sends.');
  }

  if (args.sharedMailbox) {
    recs.push(
      'Sending as a mailbox other than the authenticated user requires Exchange Send As (or Send on Behalf) permission on the target mailbox in addition to Microsoft Graph consent.'
    );
  }

  return recs;
}
