// Imported from @auth/core directly (next-auth re-exports this same class) because
// next-auth's package entry does not import cleanly outside the Next.js runtime.
import { CredentialsSignin } from '@auth/core/errors';
import logger from '@alga-psa/core/logger';
import type { IUser } from '@alga-psa/types';
import {
  evaluatePasswordLogin,
  isPasswordResetAllowed,
  isPasswordSessionRevokedByPolicy,
  refusalReasonForDecision,
  type PasswordAuthSurface,
  type PasswordLoginDecision,
  type PolicySubject,
  type TenantAuthPolicy,
} from './authPolicy';
import { loadTenantAuthPolicy, recordLoginRefusal } from './authPolicyStore';

/**
 * Shared enforcement for every surface that turns a verified password into a
 * session. `authenticateUser` calls `enforcePasswordLoginPolicy`; the NextAuth
 * credentials `authorize` callbacks call `completePasswordLoginSecondFactor`.
 * Neither re-implements any policy: the decisions live in authPolicy.ts.
 *
 * Error `code`s are surfaced to the login forms through the signIn() response.
 */

/** Password sign-in is not permitted for this user: their organization requires SSO. */
export class SsoRequiredError extends CredentialsSignin {
  code = 'SSO_REQUIRED';
}

/** A TOTP code is needed. Not a failed attempt: the form should open the code prompt. */
export class TwoFactorRequiredError extends CredentialsSignin {
  code = 'TWO_FACTOR_REQUIRED';
}

/** Policy requires 2FA and the user has none: the form must run forced enrollment. */
export class TwoFactorEnrollmentRequiredError extends CredentialsSignin {
  code = 'TWO_FACTOR_ENROLLMENT_REQUIRED';
}

export function toPolicySubject(user: IUser): PolicySubject {
  return {
    userId: String(user.user_id),
    userType: user.user_type === 'client' ? 'client' : 'internal',
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    knownDeviceSkipEnabled: Boolean((user as any).two_factor_required_new_device),
  };
}

/** Evaluate without side effects. Fails closed: a policy that cannot be read throws. */
export async function resolvePasswordLoginDecision(
  user: IUser,
): Promise<{ decision: PasswordLoginDecision; policy: TenantAuthPolicy }> {
  const policy = await loadTenantAuthPolicy(user.tenant);
  return { decision: evaluatePasswordLogin(toPolicySubject(user), policy), policy };
}

/**
 * The choke point called from `authenticateUser` once a password has verified.
 * Refuses (and audits) SSO-required and forced-enrollment outcomes; returns the
 * decision otherwise so the caller can run the TOTP step.
 */
export async function enforcePasswordLoginPolicy(
  user: IUser,
  surface: PasswordAuthSurface,
): Promise<PasswordLoginDecision> {
  const { decision } = await resolvePasswordLoginDecision(user);
  const reason = refusalReasonForDecision(decision);
  if (reason) {
    await recordLoginRefusal({
      tenant: user.tenant,
      userId: String(user.user_id),
      userType: user.user_type,
      reason,
      surface,
    });
    throw decision.outcome === 'deny-sso-required'
      ? new SsoRequiredError()
      : new TwoFactorEnrollmentRequiredError();
  }
  return decision;
}

export function surfaceForUserType(userType: string | undefined): PasswordAuthSurface {
  return userType === 'client' ? 'client_login' : userType === 'internal' ? 'msp_login' : 'credentials';
}

/**
 * Second-factor step of a password sign-in.
 * Resolves when the user may proceed; throws otherwise.
 *
 *  - no TOTP required                    -> resolves
 *  - known device and skip permitted      -> resolves
 *  - code missing                         -> TwoFactorRequiredError (flow signal, not a failure)
 *  - code wrong                           -> `onInvalidCode()` then throws a plain CredentialsSignin
 */
export async function completePasswordLoginSecondFactor(params: {
  user: IUser;
  twoFactorCode: string | undefined;
  request: unknown;
  onInvalidCode: () => Promise<void>;
}): Promise<void> {
  const { user, twoFactorCode, request } = params;
  const decision = await enforcePasswordLoginPolicy(user, surfaceForUserType(user.user_type));
  if (decision.outcome !== 'require-2fa') {
    return;
  }

  if (decision.allowKnownDeviceSkip && request) {
    try {
      const { generateDeviceFingerprint } = await import('./deviceFingerprint');
      const { UserSession } = await import('@alga-psa/db/models/UserSession');
      const userAgent = (request as any).headers?.get?.('user-agent') || 'unknown';
      const isKnown = await UserSession.isKnownDevice(
        user.tenant,
        String(user.user_id),
        generateDeviceFingerprint(userAgent),
      );
      if (isKnown) {
        return;
      }
    } catch (error) {
      // On error, require 2FA for security.
      logger.warn('[passwordLoginGate] Device recognition check failed, requiring 2FA', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!twoFactorCode) {
    throw new TwoFactorRequiredError();
  }
  if (!user.two_factor_secret) {
    logger.warn('[passwordLoginGate] 2FA required but no secret is stored', { userId: user.user_id });
    throw new CredentialsSignin();
  }
  const { verifyAuthenticator } = await import('./authenticator/authenticator');
  if (!verifyAuthenticator(twoFactorCode, user.two_factor_secret)) {
    // A wrong TOTP code is guessable evidence just like a wrong password, so it
    // shares the same failure budget.
    await params.onInvalidCode();
    throw new CredentialsSignin();
  }
}

/**
 * JWT-callback check for existing sessions. True when the tenant now requires SSO
 * and this token is an internal password session minted before the cutoff.
 * Never throws: when the policy cannot be read the token is left alone, matching
 * how an unverifiable session lookup is treated.
 */
export async function isTokenRevokedByLoginPolicy(token: Record<string, any>): Promise<boolean> {
  return isSessionRevokedByLoginPolicy({
    tenant: token?.tenant,
    userId: typeof token?.id === 'string' ? token.id : token?.sub,
    userType: token?.user_type,
    loginMethod: token?.login_method,
    authIssuedAtMs: token?.auth_issued_at,
  });
}

/**
 * Same check for any holder of the session claims (JWT token or decoded
 * session). Uses the cached tenant policy, so it is cheap per request. Never
 * throws; an unreadable policy leaves the session alone.
 */
export async function isSessionRevokedByLoginPolicy(claims: {
  tenant: unknown;
  userId: unknown;
  userType: unknown;
  loginMethod: unknown;
  authIssuedAtMs: unknown;
}): Promise<boolean> {
  if (claims.userType !== 'internal' || typeof claims.tenant !== 'string') {
    return false;
  }
  try {
    const policy = await loadTenantAuthPolicy(claims.tenant);
    return isPasswordSessionRevokedByPolicy(
      {
        userId: typeof claims.userId === 'string' ? claims.userId : undefined,
        userType: claims.userType,
        loginMethod: typeof claims.loginMethod === 'string' ? claims.loginMethod : undefined,
        authIssuedAtMs: typeof claims.authIssuedAtMs === 'number' ? claims.authIssuedAtMs : undefined,
      },
      policy,
    );
  } catch (error) {
    logger.warn('[passwordLoginGate] Could not evaluate login policy for session', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Password-reset gate (request and completion). Under SSO-required, an internal
 * non-break-glass user gets no reset. Callers must answer neutrally so the
 * response reveals nothing about the account. Fails closed for internal users
 * when the policy cannot be read; client users are never affected.
 */
export async function isPasswordResetPermitted(
  user: { user_id: string; tenant: string; user_type: string },
  surface: 'password_reset_request' | 'password_reset_complete',
): Promise<boolean> {
  if (user.user_type !== 'internal') {
    return true;
  }
  try {
    const policy = await loadTenantAuthPolicy(user.tenant);
    if (isPasswordResetAllowed({ userId: String(user.user_id), userType: 'internal' }, policy)) {
      return true;
    }
  } catch (error) {
    logger.warn('[passwordLoginGate] Could not read login policy for password reset; refusing', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  await recordLoginRefusal({
    tenant: user.tenant,
    userId: String(user.user_id),
    userType: user.user_type,
    reason: 'sso_required',
    surface,
  });
  return false;
}
