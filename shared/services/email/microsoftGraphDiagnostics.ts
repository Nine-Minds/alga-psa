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

// Correlation ids are opaque provider tokens, not free-form user data. Trim,
// reject empties/non-strings, and cap the length so a hostile/large body cannot
// bloat a report.
const MAX_CORRELATION_ID_LENGTH = 256;

function safeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_CORRELATION_ID_LENGTH
    ? trimmed.slice(0, MAX_CORRELATION_ID_LENGTH)
    : trimmed;
}

/**
 * Read only the two Graph correlation ids from `error.innerError` of a native
 * (`response.data`) or already-sanitized (`responseBody`) Graph error.
 *
 * Microsoft returns request-id / client-request-id here (and sometimes nowhere
 * else) for body-only failures such as a 403 ErrorSendAsDenied that carries no
 * correlation response headers. This is a last-resort fallback: nothing else
 * from the body is read, so raw bodies still never reach a report or export.
 */
export function extractGraphBodyCorrelationIds(body: unknown): {
  requestId?: string;
  clientRequestId?: string;
} {
  const graphError = (body as any)?.error;
  const innerError = graphError?.innerError ?? (body as any)?.innerError;
  return {
    requestId: safeCorrelationId(innerError?.['request-id']),
    clientRequestId: safeCorrelationId(innerError?.['client-request-id']),
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

/**
 * Outbound-only normalization that preserves evidence `classifyGraphFailure`
 * cannot see: correlation ids carried at the top level of already-sanitized
 * errors, and EmailProviderError's errorCode/metadata. Inbound keeps using
 * `classifyGraphFailure` so its observable report is unchanged.
 */
export function normalizeOutboundGraphFailure(error: any): GraphFailure {
  const base = classifyGraphFailure(error);
  const metadata = error?.metadata as Record<string, unknown> | undefined;
  const providerCode = typeof error?.errorCode === 'string' ? error.errorCode : undefined;
  const topRequestId = typeof error?.requestId === 'string' ? error.requestId : undefined;
  const topClientRequestId = typeof error?.clientRequestId === 'string' ? error.clientRequestId : undefined;
  const metaRequestId = typeof metadata?.requestId === 'string' ? metadata.requestId : undefined;
  const metaClientRequestId = typeof metadata?.clientRequestId === 'string' ? metadata.clientRequestId : undefined;
  const metaStatus = Number.isFinite(Number(metadata?.status)) ? Number(metadata?.status) : undefined;
  const metaCode = typeof metadata?.code === 'string' ? metadata.code : undefined;
  // Last-resort fallback for a body-only Graph failure. The body may be the raw
  // `response.data` or the sanitized `responseBody`; both expose `error.innerError`.
  const bodyIds = extractGraphBodyCorrelationIds(base.responseBody);

  // classifyGraphFailure synthesizes `code` from the HTTP status. Prefer a real
  // provider/graph code over that synthesized value.
  const syntheticStatus = base.status !== undefined ? String(base.status) : undefined;
  const explicitBaseCode = base.code && base.code !== syntheticStatus ? base.code : undefined;
  const code = explicitBaseCode ?? providerCode ?? metaCode ?? base.code;
  const status = base.status ?? metaStatus;

  return {
    status,
    code,
    message: base.message,
    requestId: base.requestId ?? topRequestId ?? metaRequestId ?? bodyIds.requestId,
    clientRequestId:
      base.clientRequestId ?? topClientRequestId ?? metaClientRequestId ?? bodyIds.clientRequestId,
    responseBody: base.responseBody,
  };
}

export type SendPermissionDenial =
  | 'send-as-denied'
  | 'send-on-behalf-denied'
  | 'access-denied'
  | 'unknown';

/**
 * Classify a Graph/Exchange denial code. ErrorSendAsDenied and
 * ErrorSendOnBehalfDenied are provider-confirmed Exchange permission denials;
 * they are distinct from Graph Mail.Send consent and from a generic 403.
 */
export function classifySendPermissionDenial(code?: string): SendPermissionDenial {
  if (!code) return 'unknown';
  const normalized = code.toLowerCase();
  if (normalized.includes('sendasdenied')) return 'send-as-denied';
  if (normalized.includes('sendonbehalf') || normalized.includes('onbehalfdenied')) {
    return 'send-on-behalf-denied';
  }
  if (normalized.includes('accessdenied') || normalized.includes('forbidden')) return 'access-denied';
  return 'unknown';
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
  /** True when the authenticated identity could not be confirmed. */
  identityUnknown?: boolean;
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
    const denial = classifySendPermissionDenial(args.code);
    if (denial === 'send-as-denied') {
      recs.push(
        'Microsoft Graph/Exchange rejected the send with ErrorSendAsDenied, a provider-confirmed Exchange send-permission denial for the target mailbox. This is distinct from Microsoft Graph Mail.Send consent. Grant the sending identity Exchange Send As on the shared mailbox (or Send on Behalf). Send on Behalf appears as "<sender> on behalf of <mailbox>", which is not the same as Send As.'
      );
    } else if (denial === 'send-on-behalf-denied') {
      recs.push(
        'Microsoft Graph/Exchange rejected the send with ErrorSendOnBehalfDenied, a provider-confirmed Exchange Send on Behalf denial for the target mailbox. Grant the sending identity Send on Behalf (or Send As). Send on Behalf appears as "<sender> on behalf of <mailbox>", which is not the same as Send As.'
      );
    } else {
      recs.push(
        'Microsoft Graph returned 403 (Forbidden). This alone does not identify the missing permission: verify Mail.Send consent and, when sending as a shared/delegated mailbox, Exchange Send As (or Send on Behalf) for the sending identity.'
      );
    }
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

  if (args.identityUnknown) {
    recs.push(
      'The authenticated Microsoft identity could not be confirmed, so whether Mail.Send.Shared or Exchange Send As is required is unknown. Reconnect the mailbox and re-run diagnostics.'
    );
  }

  return recs;
}
