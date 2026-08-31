/**
 * Central authorization for the QuickBooks Online and Xero connection flows.
 *
 * Both providers enforce the same policy in the same order at the callback
 * boundary:
 *
 *   1. the OAuth state is atomically consumed (single use),
 *   2. the current live user is resolved from the session,
 *   3. the live user must be the user the state was issued to, in the state's
 *      tenant, and must still resolve (not disabled or removed),
 *   4. the user must still hold the accounting connection-admin permission,
 *   5. only then may the callback exchange the code and persist credentials.
 *
 * The connection-admin permission is centralized here so a future permission
 * split (e.g. a narrower `accounting_connection:manage`) swaps in one place
 * without touching either provider's routes.
 */

import axios from 'axios';
import logger from '@alga-psa/core/logger';
import { getCurrentUserWithRevocationCheck, hasPermission } from '@alga-psa/auth';
import type { IUser, IUserWithRoles } from '@alga-psa/types';
import {
  consumeAccountingOAuthNonce,
  type AccountingOAuthProvider
} from './accountingOAuthStateStore';

export const ACCOUNTING_CONNECTION_ADMIN_PERMISSION = {
  resource: 'billing_settings',
  action: 'update'
} as const;

export const ACCOUNTING_OAUTH_AUTHZ_ERRORS = {
  STATE_REPLAYED: 'STATE_REPLAYED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  USER_MISMATCH: 'USER_MISMATCH',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  FORBIDDEN: 'FORBIDDEN'
} as const;

export type AccountingOAuthAuthzErrorCode =
  (typeof ACCOUNTING_OAUTH_AUTHZ_ERRORS)[keyof typeof ACCOUNTING_OAUTH_AUTHZ_ERRORS];

export interface AccountingOAuthStateClaim {
  provider: AccountingOAuthProvider;
  tenantId: string;
  userId: string;
  nonce: string;
}

export type AccountingOAuthAuthzResult =
  | { ok: true; liveUser: IUserWithRoles }
  | { ok: false; code: AccountingOAuthAuthzErrorCode; message: string };

function reject(
  code: AccountingOAuthAuthzErrorCode,
  message: string
): AccountingOAuthAuthzResult {
  return { ok: false, code, message };
}

/**
 * The single place the accounting connection-admin policy is defined. Today it
 * resolves to `billing_settings:update`; swap the resource/action here when a
 * narrower permission lands.
 */
export async function canManageAccountingConnections(
  user: IUser
): Promise<boolean> {
  return hasPermission(
    user,
    ACCOUNTING_CONNECTION_ADMIN_PERMISSION.resource,
    ACCOUNTING_CONNECTION_ADMIN_PERMISSION.action
  );
}

/**
 * Resolve the current live user for an accounting connection flow. Uses the
 * revocation-checked resolver so a revoked session, a disabled user, or a
 * removed user resolves to no caller.
 */
export async function getAccountingConnectionSessionUser(): Promise<IUserWithRoles | null> {
  return getCurrentUserWithRevocationCheck();
}

async function verifyLiveUserMatchesClaim(
  claim: Pick<AccountingOAuthStateClaim, 'tenantId' | 'userId'>
): Promise<AccountingOAuthAuthzResult> {
  const liveUser = await getCurrentUserWithRevocationCheck();
  if (!liveUser) {
    return reject(
      ACCOUNTING_OAUTH_AUTHZ_ERRORS.AUTH_REQUIRED,
      'Your session is no longer valid. Please sign in and try the connection again.'
    );
  }

  if (liveUser.user_id !== claim.userId) {
    return reject(
      ACCOUNTING_OAUTH_AUTHZ_ERRORS.USER_MISMATCH,
      'This connection request belongs to another user. Start the connection again.'
    );
  }

  if (liveUser.tenant !== claim.tenantId) {
    return reject(
      ACCOUNTING_OAUTH_AUTHZ_ERRORS.TENANT_MISMATCH,
      'This connection request belongs to another workspace. Start the connection again.'
    );
  }

  const canManage = await canManageAccountingConnections(liveUser);
  if (!canManage) {
    return reject(
      ACCOUNTING_OAUTH_AUTHZ_ERRORS.FORBIDDEN,
      'You no longer have permission to manage accounting connections.'
    );
  }

  return { ok: true, liveUser };
}

/**
 * Authorize an accounting OAuth callback before it exchanges the code.
 *
 * Consumes the state atomically on every presentation, so a denied or replayed
 * callback leaves no reusable state, then verifies the live session user is
 * still the issuing user, in the issuing tenant, with the connection-admin
 * permission.
 */
export async function authorizeAccountingOAuthCallback(
  claim: AccountingOAuthStateClaim
): Promise<AccountingOAuthAuthzResult> {
  const consumed = await consumeAccountingOAuthNonce(claim.provider, claim.nonce);
  if (!consumed) {
    return reject(
      ACCOUNTING_OAUTH_AUTHZ_ERRORS.STATE_REPLAYED,
      'This connection request was already used. Start the connection again.'
    );
  }

  return verifyLiveUserMatchesClaim(claim);
}

/**
 * Re-check authorization immediately before persisting tokens. The pre-exchange
 * check and this one can disagree only in the window between the exchange and
 * the write, so callers that hit a denial here must revoke the just-obtained
 * grant provider-side and store nothing.
 */
export async function reauthorizeAccountingOAuthCallback(
  claim: Pick<AccountingOAuthStateClaim, 'tenantId' | 'userId'>
): Promise<AccountingOAuthAuthzResult> {
  return verifyLiveUserMatchesClaim(claim);
}

const QBO_REVOKE_URL =
  process.env.QBO_OAUTH_REVOKE_URL?.trim() ||
  'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const XERO_REVOKE_URL =
  process.env.XERO_OAUTH_REVOKE_URL?.trim() ||
  'https://identity.xero.com/connect/revocation';

/**
 * Best-effort revocation of an obtained grant whose persistence-time
 * authorization failed. Never throws; failures are logged and swallowed so a
 * revoke hiccup cannot mask the denial already returned to the caller.
 */
export async function revokeAccountingOAuthGrant(params: {
  provider: AccountingOAuthProvider;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<void> {
  const { provider, clientId, clientSecret, refreshToken } = params;
  const url = provider === 'qbo' ? QBO_REVOKE_URL : XERO_REVOKE_URL;
  // QBO mirrors the disconnect-flow revocation (JSON `{ token }`); Xero's
  // revocation endpoint takes a form-encoded `token` with a token-type hint.
  const body =
    provider === 'qbo'
      ? { token: refreshToken }
      : new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' }).toString();

  try {
    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    await axios.post(url, body, {
      headers: {
        'Content-Type':
          provider === 'qbo' ? 'application/json' : 'application/x-www-form-urlencoded',
        Authorization: authHeader
      },
      timeout: 10000
    });
    logger.info('[accountingOAuth] Revoked an unpersisted accounting grant', { provider });
  } catch (error) {
    logger.warn('[accountingOAuth] Failed to revoke an unpersisted accounting grant', {
      provider,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
