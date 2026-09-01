/**
 * Strict, provider-neutral classification of inbound source-access failures.
 *
 * Only explicitly terminal credential failures count toward the automatic
 * auth-failure pause. Everything else — throttling (429), server errors (5xx),
 * timeouts, DNS/socket failures, Graph permission (403) / not-found (404)
 * errors, webhook validation failures, MIME parsing errors, and downstream
 * ticket-processing exceptions — must NEVER advance the pause counter.
 *
 * Classification reads structured adapter error metadata only:
 *   - `error.status` / `error.response.status`
 *   - `error.responseBody` / `error.response.data`
 *   - IMAP explicit auth-rejection flags (`authenticationFailed`,
 *     `serverResponseCode`, `responseStatus`/`responseText`)
 *
 * It must not do broad substring matching on messages (e.g. "401" or "auth"):
 * the only allowlisted message-level token is the explicit AADSTS code for a
 * revoked/expired Microsoft grant.
 */

/** Consecutive strictly-classified failures required to auto-pause a provider. */
export const INBOUND_AUTH_FAILURE_PAUSE_THRESHOLD = 3;

export type InboundAuthFailureClassification =
  | { kind: 'unrecoverable_auth'; code: string }
  | { kind: 'not_unrecoverable' };

export type InboundAuthFailureProviderType = 'microsoft' | 'google' | 'imap';

const NOT_UNRECOVERABLE: InboundAuthFailureClassification = { kind: 'not_unrecoverable' };

/** Microsoft token-endpoint OAuth errors that cannot recover on their own. */
const MICROSOFT_TOKEN_ERROR_ALLOWLIST = new Set(['invalid_client', 'invalid_grant']);

/** Google token-endpoint OAuth errors that cannot recover on their own. */
const GOOGLE_TOKEN_ERROR_ALLOWLIST = new Set(['invalid_grant']);

/** IMAP OAuth token-endpoint OAuth errors that cannot recover on their own. */
const IMAP_TOKEN_ERROR_ALLOWLIST = new Set(['invalid_client', 'invalid_grant']);

/** Microsoft error_description token for a revoked or expired refresh grant. */
const MICROSOFT_REVOKED_GRANT_TOKEN = 'AADSTS50173';

function asTrimmedLowerString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function readOAuthErrorBody(error: any): {
  error: string | null;
  errorDescription: string;
  errorSubtype: string | null;
} {
  const body = error?.responseBody ?? error?.response?.data;
  if (!body || typeof body !== 'object') {
    return { error: null, errorDescription: '', errorSubtype: null };
  }
  return {
    error: asTrimmedLowerString((body as any).error),
    errorDescription:
      typeof (body as any).error_description === 'string' ? (body as any).error_description : '',
    errorSubtype: asTrimmedLowerString((body as any).error_subtype),
  };
}

function isImapAuthenticationRejection(error: any): boolean {
  if (error?.authenticationFailed === true) return true;

  const serverCode = String(error?.serverResponseCode || '').toUpperCase();
  if (serverCode.includes('AUTHENTICATIONFAILED')) return true;

  const responseStatus = String(error?.responseStatus || '').toUpperCase();
  if (responseStatus === 'NO' && /invalid credentials/i.test(String(error?.responseText || ''))) {
    return true;
  }

  return false;
}

/** Reduce a classified reason to a safe, bounded code (never error text). */
function toSafeCode(code: string): string {
  const sanitized = code.toLowerCase().replace(/[^a-z0-9_:-]/g, '').slice(0, 100);
  return sanitized.length > 0 ? sanitized : 'unrecoverable_auth';
}

export function classifyInboundAuthFailure(params: {
  providerType: InboundAuthFailureProviderType;
  error: unknown;
}): InboundAuthFailureClassification {
  const error: any = params.error;
  if (!error) return NOT_UNRECOVERABLE;

  const { error: oauthError, errorDescription, errorSubtype } = readOAuthErrorBody(error);

  if (params.providerType === 'microsoft') {
    if (oauthError && MICROSOFT_TOKEN_ERROR_ALLOWLIST.has(oauthError)) {
      return { kind: 'unrecoverable_auth', code: toSafeCode(`microsoft:${oauthError}`) };
    }
    if (errorDescription.includes(MICROSOFT_REVOKED_GRANT_TOKEN)) {
      return {
        kind: 'unrecoverable_auth',
        code: toSafeCode('microsoft:invalid_grant:aadsts50173'),
      };
    }
    return NOT_UNRECOVERABLE;
  }

  if (params.providerType === 'google') {
    if (oauthError && GOOGLE_TOKEN_ERROR_ALLOWLIST.has(oauthError)) {
      return {
        kind: 'unrecoverable_auth',
        code: toSafeCode(
          errorSubtype ? `google:${oauthError}:${errorSubtype}` : `google:${oauthError}`
        ),
      };
    }
    return NOT_UNRECOVERABLE;
  }

  // IMAP: OAuth token-endpoint terminal errors, then explicit protocol-level
  // authentication rejections (password or OAuth login rejected by the server).
  if (oauthError && IMAP_TOKEN_ERROR_ALLOWLIST.has(oauthError)) {
    return {
      kind: 'unrecoverable_auth',
      code: toSafeCode(
        errorSubtype ? `imap:${oauthError}:${errorSubtype}` : `imap:${oauthError}`
      ),
    };
  }
  if (isImapAuthenticationRejection(error)) {
    return { kind: 'unrecoverable_auth', code: toSafeCode('imap:authentication_failed') };
  }
  return NOT_UNRECOVERABLE;
}
