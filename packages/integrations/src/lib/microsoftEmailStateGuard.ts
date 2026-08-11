/**
 * Server-side enforcement of the relationships signed into the Microsoft
 * inbound-email mailbox OAuth state.
 *
 * A signed state is only a *cryptographically intact* claim. The callback must
 * additionally verify every relationship the claim asserts before touching a
 * provider's credentials: the authenticated session user owns the state, the
 * provider referenced by the state exists in the state's tenant and is a
 * Microsoft email provider, and the purpose cannot be abused (a `create` state
 * must never clobber an already-connected provider; a `reconnect` state must
 * actually name a provider).
 *
 * Each rejection is a distinct, stable machine-readable failure — never a
 * silent fallthrough.
 */

import {
  MICROSOFT_EMAIL_ISSUER_ERRORS,
  type MicrosoftEmailIssuerErrorCode,
} from './microsoftEmailIssuerSelection';
import type { MicrosoftEmailOAuthStatePayload } from '../utils/email/microsoftEmailOAuthState';

export interface MicrosoftEmailStateProviderContext {
  id?: string | null;
  tenant?: string | null;
  provider_type?: string | null;
  refresh_token?: string | null;
  status?: string | null;
}

export type MicrosoftEmailStateGuardResult =
  | { ok: true }
  | { ok: false; code: MicrosoftEmailIssuerErrorCode; message: string };

function reject(
  code: MicrosoftEmailIssuerErrorCode,
  message: string
): MicrosoftEmailStateGuardResult {
  return { ok: false, code, message };
}

export function verifyMicrosoftEmailOAuthStateRelationships(input: {
  payload: MicrosoftEmailOAuthStatePayload;
  sessionUser?: { user_id?: string | null; tenant?: string | null } | null;
  /** The `email_providers` row for the state's providerId, when it exists. */
  provider?: MicrosoftEmailStateProviderContext | null;
}): MicrosoftEmailStateGuardResult {
  const { payload, sessionUser, provider } = input;

  // User binding: the session user handling the callback must be the user who
  // signed the state. A mismatch means another user (or a forged session) is
  // trying to consume someone else's authorization.
  if (!sessionUser?.tenant || sessionUser.tenant !== payload.tenant) {
    return reject(
      MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE,
      'Your session does not match the requested tenant. Please sign in and retry.'
    );
  }
  if (!sessionUser.user_id || sessionUser.user_id !== payload.userId) {
    return reject(
      MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_USER_MISMATCH,
      'This Microsoft authorization request belongs to another user. Start again from the mailbox form.'
    );
  }

  // Reconnect must name a provider; without one the callback has nowhere to
  // store the renewed credentials.
  if (payload.purpose === 'reconnect' && !payload.providerId) {
    return reject(
      MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_PURPOSE_MISMATCH,
      'A reconnect request must reference the mailbox being reconnected. Start again from the mailbox form.'
    );
  }

  // Any state that names a provider must point at a real Microsoft email
  // provider in the state's tenant. Without this, a forged or stale state could
  // write tokens into an unrelated or non-Microsoft row.
  if (payload.providerId) {
    if (!provider?.id) {
      return reject(
        MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_NOT_FOUND,
        'The mailbox for this authorization request no longer exists. Start again from the mailbox form.'
      );
    }
    if (provider.tenant !== payload.tenant) {
      return reject(
        MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_TENANT_MISMATCH,
        'The mailbox for this authorization request belongs to another workspace. Start again from the mailbox form.'
      );
    }
    if (provider.provider_type !== 'microsoft') {
      return reject(
        MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_TYPE_NOT_SUPPORTED,
        'The mailbox for this authorization request is not a Microsoft mailbox. Start again from the mailbox form.'
      );
    }
  }

  // Purpose semantics: a `create` state must never overwrite the credentials
  // of an already-connected provider. Create flows sign a state for a brand-new
  // row (no refresh token yet); anything else is a reconnect and must go
  // through the reconnect flow.
  if (
    payload.purpose === 'create' &&
    payload.providerId &&
    provider &&
    Boolean(provider.refresh_token)
  ) {
    return reject(
      MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_PURPOSE_MISMATCH,
      'This mailbox is already connected. Reconnect it instead of authorizing it as new.'
    );
  }

  return { ok: true };
}
