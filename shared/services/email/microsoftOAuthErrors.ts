/**
 * Maps Microsoft identity-platform OAuth rejections (AADSTS codes) to specific,
 * actionable messages, and reduces axios/token-endpoint failures to a log-safe
 * shape. A raw axios error carries `config.data` — the urlencoded token request
 * body including `client_secret` — so it must never be logged directly.
 */

export type MicrosoftOAuthFailureKind =
  | 'single_tenant_app' // AADSTS50194
  | 'app_not_in_directory' // AADSTS700016
  | 'user_wrong_directory' // AADSTS50020
  | 'redirect_uri_mismatch' // AADSTS50011
  | 'invalid_client_secret' // AADSTS7000215
  | 'expired_client_secret' // AADSTS7000222
  | 'admin_consent_required'; // error=consent_required, AADSTS65001, AADSTS90094

export interface MicrosoftOAuthFailureInput {
  error?: string | null;
  errorDescription?: string | null;
  errorCodes?: ReadonlyArray<number | string> | null;
}

const CODE_TO_KIND: Record<number, MicrosoftOAuthFailureKind> = {
  50194: 'single_tenant_app',
  700016: 'app_not_in_directory',
  50020: 'user_wrong_directory',
  50011: 'redirect_uri_mismatch',
  7000215: 'invalid_client_secret',
  7000222: 'expired_client_secret',
  65001: 'admin_consent_required',
  90094: 'admin_consent_required',
};

export function extractAadstsCode(input: MicrosoftOAuthFailureInput): number | null {
  for (const raw of input.errorCodes ?? []) {
    const n = Number(raw);
    if (Number.isInteger(n) && CODE_TO_KIND[n]) return n;
  }
  const match = /AADSTS(\d{3,6})/i.exec(input.errorDescription || '');
  if (match) {
    const n = Number(match[1]);
    if (CODE_TO_KIND[n]) return n;
  }
  return null;
}

export function classifyMicrosoftOAuthFailure(
  input: MicrosoftOAuthFailureInput
): MicrosoftOAuthFailureKind | null {
  const code = extractAadstsCode(input);
  if (code) return CODE_TO_KIND[code];
  // The authorize redirect reports a missing grant as a bare OAuth error.
  if ((input.error || '').toLowerCase() === 'consent_required') return 'admin_consent_required';
  return null;
}

/** Pulls the redirect URI Microsoft names in an AADSTS50011 description. */
export function extractRedirectUriFromDescription(description?: string | null): string | null {
  const match = /redirect URI '([^']+)'/i.exec(description || '');
  return match ? match[1] : null;
}

/**
 * Stable machine codes handed to the UI (Entra: `?error=`; email/calendar:
 * postMessage `error`). Distinct from the raw AADSTS number so they can be
 * mapped to i18n keys.
 */
export const MICROSOFT_OAUTH_FAILURE_ERROR_CODES: Record<MicrosoftOAuthFailureKind, string> = {
  single_tenant_app: 'aadsts_50194_single_tenant',
  app_not_in_directory: 'aadsts_700016_app_not_found',
  user_wrong_directory: 'aadsts_50020_wrong_directory',
  redirect_uri_mismatch: 'aadsts_50011_redirect_uri',
  invalid_client_secret: 'aadsts_7000215_invalid_secret',
  expired_client_secret: 'aadsts_7000222_expired_secret',
  // Stable UI code the Outlook Calendar connect form keys its pending state on.
  admin_consent_required: 'pending_admin_consent',
};

export function kindFromMicrosoftOAuthErrorCode(code: string | null | undefined): MicrosoftOAuthFailureKind | null {
  for (const [kind, value] of Object.entries(MICROSOFT_OAUTH_FAILURE_ERROR_CODES)) {
    if (value === code) return kind as MicrosoftOAuthFailureKind;
  }
  return null;
}

/**
 * True for a `<machine code>: <message>` string produced by
 * formatMicrosoftOAuthFailureForMailboxFlow (the code before the first `:` is a
 * known MICROSOFT_OAUTH_FAILURE_ERROR_CODES value).
 */
export function isMappedMicrosoftOAuthMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  const idx = message.indexOf(':');
  if (idx <= 0) return false;
  return kindFromMicrosoftOAuthErrorCode(message.slice(0, idx)) !== null;
}

/** Email / calendar callback copy (the callbacks post this to the opener window). */
export function describeMicrosoftOAuthFailureForMailboxFlow(
  kind: MicrosoftOAuthFailureKind,
  context: { redirectUri?: string | null } = {}
): string {
  switch (kind) {
    case 'single_tenant_app':
      return 'Microsoft rejected the sign-in because this app registration is single-tenant. Enter the directory (tenant) ID on the Microsoft profile, or make the app multi-tenant (Accounts in any organizational directory).';
    case 'app_not_in_directory':
      return "Microsoft could not find this app registration in the directory named by the profile's Tenant ID. Check that the Tenant ID on the Microsoft profile is the directory (tenant) ID where the app was registered.";
    case 'user_wrong_directory':
      return 'The account you signed in with belongs to a different directory than this single-tenant app. Sign in with an account from the app\'s directory, or make the app multi-tenant.';
    case 'invalid_client_secret':
      return 'Microsoft rejected the client secret on the Microsoft profile. Make sure you saved the secret Value, not its Secret ID.';
    case 'expired_client_secret':
      return 'The client secret on the Microsoft profile has expired. Create a new secret in Azure and update the profile.';
    case 'admin_consent_required':
      return 'Microsoft needs a Microsoft 365 administrator to approve this app before anyone can connect. Ask an administrator to grant admin consent for the app\'s delegated permissions, then connect again.';
    case 'redirect_uri_mismatch':
      return context.redirectUri
        ? `Microsoft rejected the redirect URI because it is not registered on the app. Add this exact URI under Authentication > Web redirect URIs: ${context.redirectUri}`
        : 'Microsoft rejected the redirect URI because it is not registered on the app. Add the redirect URI shown on the Microsoft app registration screen under Authentication > Web redirect URIs.';
  }
}

/**
 * The `<machine code>: <message>` string persisted to a provider's error field
 * (email_providers.error_message) for a mapped failure. Shared by the OAuth
 * callbacks' persistence and the background token-refresh paths so a stored
 * error reads the same whichever path produced it.
 */
export function formatMicrosoftOAuthFailureForMailboxFlow(
  kind: MicrosoftOAuthFailureKind,
  context: { redirectUri?: string | null } = {}
): string {
  return `${MICROSOFT_OAUTH_FAILURE_ERROR_CODES[kind]}: ${describeMicrosoftOAuthFailureForMailboxFlow(kind, context)}`;
}

export interface SafeMicrosoftOAuthFailure {
  status?: number;
  error?: string;
  errorCodes?: number[];
  errorDescription?: string;
  traceId?: string;
  correlationId?: string;
  /** Network / non-HTTP failure message when there is no response body. */
  message?: string;
}

/**
 * Reduce an axios (or any) token-endpoint failure to fields that are safe to
 * log and to classify. Never includes request config, headers or body.
 */
export function toSafeMicrosoftOAuthFailure(err: unknown): SafeMicrosoftOAuthFailure {
  const e = err as any;
  const data = e?.response?.data;
  const body = data && typeof data === 'object' ? data : {};
  const out: SafeMicrosoftOAuthFailure = {};
  if (typeof e?.response?.status === 'number') out.status = e.response.status;
  if (typeof body.error === 'string') out.error = body.error;
  if (Array.isArray(body.error_codes)) out.errorCodes = body.error_codes.map(Number).filter(Number.isFinite);
  if (typeof body.error_description === 'string') out.errorDescription = body.error_description;
  if (typeof body.trace_id === 'string') out.traceId = body.trace_id;
  if (typeof body.correlation_id === 'string') out.correlationId = body.correlation_id;
  if (!e?.response && typeof e?.message === 'string') {
    // Axios network errors can embed the request URL but not the body.
    out.message = e.message;
  }
  return out;
}

export function classifySafeMicrosoftOAuthFailure(f: SafeMicrosoftOAuthFailure): MicrosoftOAuthFailureKind | null {
  return classifyMicrosoftOAuthFailure({
    error: f.error,
    errorDescription: f.errorDescription,
    errorCodes: f.errorCodes,
  });
}
