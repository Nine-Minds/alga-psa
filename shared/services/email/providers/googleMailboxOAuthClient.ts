import { getSecretProviderInstance } from '@alga-psa/core/secrets';

/**
 * The single place that decides which Google OAuth client a Gmail mailbox
 * uses. Initiate, callback and token refresh all go through it so the client
 * that issues a refresh token is always the client that redeems it.
 *
 * Google mailbox OAuth is tenant-owned (CE and EE). Alga's own Google app
 * (the GOOGLE_CLIENT_ID/SECRET environment pair used for SSO) must never be used here:
 * Google rejects its refresh attempts with `unauthorized_client`.
 */

export const GOOGLE_CLIENT_ID_SECRET = 'google_client_id';
export const GOOGLE_CLIENT_SECRET_SECRET = 'google_client_secret';

export const GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE = 'Google OAuth credentials not configured';
export const GOOGLE_OAUTH_CLIENT_CHANGED_MESSAGE =
  'Google OAuth client changed since this mailbox was connected; reconnect the mailbox.';

export type GoogleMailboxOAuthClientSource = 'row' | 'tenant';

export interface GoogleMailboxOAuthClient {
  clientId: string;
  clientSecret: string;
  source: GoogleMailboxOAuthClientSource;
}

export interface GoogleMailboxOAuthVendorConfig {
  client_id?: string | null;
  client_secret?: string | null;
  [key: string]: unknown;
}

export class GoogleOAuthClientChangedError extends Error {
  readonly code = 'google_oauth_client_changed';
  constructor() {
    super(GOOGLE_OAUTH_CLIENT_CHANGED_MESSAGE);
    this.name = 'GoogleOAuthClientChangedError';
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the OAuth client for a tenant's Google mailbox.
 *
 * Order (ID and secret always come together from one source):
 *  1. the row's `client_id` + `client_secret`, when both are present (legacy rows);
 *  2. the tenant secrets `google_client_id` + `google_client_secret`.
 *
 * When the row records the issuing `client_id` (written by the callback) and it
 * differs from the tenant's current `google_client_id`, the tenant replaced
 * their Google app after connecting: the refresh token belongs to the old
 * client, so this throws GoogleOAuthClientChangedError instead of calling Google.
 *
 * Initiate/callback pass no vendorConfig and get the tenant pair.
 */
export async function resolveGoogleMailboxOAuthClient(params: {
  tenant: string;
  vendorConfig?: GoogleMailboxOAuthVendorConfig | null;
}): Promise<GoogleMailboxOAuthClient> {
  const rowClientId = clean(params.vendorConfig?.client_id);
  const rowClientSecret = clean(params.vendorConfig?.client_secret);

  if (rowClientId && rowClientSecret) {
    return { clientId: rowClientId, clientSecret: rowClientSecret, source: 'row' };
  }

  const secretProvider = await getSecretProviderInstance();
  const tenantClientId = clean(await secretProvider.getTenantSecret(params.tenant, GOOGLE_CLIENT_ID_SECRET));
  const tenantClientSecret = clean(
    await secretProvider.getTenantSecret(params.tenant, GOOGLE_CLIENT_SECRET_SECRET)
  );

  if (!tenantClientId || !tenantClientSecret) {
    throw new Error(GOOGLE_OAUTH_NOT_CONFIGURED_MESSAGE);
  }

  if (rowClientId && rowClientId !== tenantClientId) {
    throw new GoogleOAuthClientChangedError();
  }

  return { clientId: tenantClientId, clientSecret: tenantClientSecret, source: 'tenant' };
}

export const GOOGLE_UNAUTHORIZED_CLIENT_MESSAGE =
  'Google rejected the token refresh with unauthorized_client: the OAuth client no longer matches the one that authorized this mailbox. Reconnect the mailbox.';
export const GOOGLE_INVALID_GRANT_MESSAGE =
  'Google reports the mailbox authorization has expired or been revoked (invalid_grant). Reconnect the mailbox. If your Google OAuth consent screen is User Type External with publishing status Testing, Google expires authorizations after 7 days; switch it to Internal or publish the app.';

/** Prefixes by which downstream code recognises an already-actionable message. */
export const ACTIONABLE_GOOGLE_OAUTH_MESSAGES = [
  GOOGLE_OAUTH_CLIENT_CHANGED_MESSAGE,
  GOOGLE_UNAUTHORIZED_CLIENT_MESSAGE,
  GOOGLE_INVALID_GRANT_MESSAGE,
];

export function isActionableGoogleOAuthMessage(message: unknown): boolean {
  return (
    typeof message === 'string' &&
    ACTIONABLE_GOOGLE_OAUTH_MESSAGES.some((m) => message.includes(m))
  );
}

/**
 * Map a Google token-endpoint refresh failure to an admin-actionable error.
 * Returns null when the failure is not one of the OAuth errors we explain.
 * Structured metadata (status, code, responseBody) is preserved so the strict
 * auth-failure policy keeps classifying on it: `invalid_grant` still counts
 * toward auto-pause, `unauthorized_client` (a configuration mismatch) does not.
 */
export function toActionableGoogleRefreshError(error: any): Error | null {
  if (error instanceof GoogleOAuthClientChangedError) return error;
  const body = error?.response?.data ?? error?.responseBody;
  const oauthError = typeof body?.error === 'string' ? body.error.trim().toLowerCase() : null;

  let message: string | null = null;
  if (oauthError === 'unauthorized_client') message = GOOGLE_UNAUTHORIZED_CLIENT_MESSAGE;
  else if (oauthError === 'invalid_grant') message = GOOGLE_INVALID_GRANT_MESSAGE;
  if (!message) return null;

  const description = typeof body?.error_description === 'string' ? body.error_description : '';
  const wrapped = new Error(description ? `${message} Google said: ${description}` : message);
  Object.assign(wrapped, {
    status: error?.response?.status ?? error?.status,
    code: error?.response?.status ?? error?.code,
    responseBody: body,
  });
  return wrapped;
}
