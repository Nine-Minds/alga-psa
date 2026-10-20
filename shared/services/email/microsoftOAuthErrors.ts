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
  | 'redirect_uri_mismatch'; // AADSTS50011

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
  return code ? CODE_TO_KIND[code] : null;
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
};

export function kindFromMicrosoftOAuthErrorCode(code: string | null | undefined): MicrosoftOAuthFailureKind | null {
  for (const [kind, value] of Object.entries(MICROSOFT_OAUTH_FAILURE_ERROR_CODES)) {
    if (value === code) return kind as MicrosoftOAuthFailureKind;
  }
  return null;
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
    case 'redirect_uri_mismatch':
      return context.redirectUri
        ? `Microsoft rejected the redirect URI because it is not registered on the app. Add this exact URI under Authentication > Web redirect URIs: ${context.redirectUri}`
        : 'Microsoft rejected the redirect URI because it is not registered on the app. Add the redirect URI shown on the Microsoft app registration screen under Authentication > Web redirect URIs.';
  }
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
