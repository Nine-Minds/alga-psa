'use server'

import { headers } from 'next/headers.js';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import type { IUser } from '@alga-psa/types';
import { isValidTenantSlug } from '@alga-psa/validation';
import { authenticateUser } from '../auth';

/**
 * Forced TOTP enrollment at sign-in.
 *
 * Mechanism: when a tenant 2FA policy applies to a user with no authenticator,
 * `authenticateUser` refuses the password login with the NextAuth error code
 * `TWO_FACTOR_ENROLLMENT_REQUIRED` (after the password verified). The login form
 * then calls these two actions, which re-verify the password (no session exists
 * yet), hand out a server-generated secret/QR, and on a valid first code store it
 * in the existing per-user fields (`two_factor_enabled` / `two_factor_secret`).
 * The form then resumes the normal TOTP prompt and signs in with a code.
 *
 * These actions are an unauthenticated surface, so they share the sign-in
 * brute-force budget (enforceLoginProtection / recordLoginFailure) and refuse to
 * run unless the policy genuinely requires enrollment for that user: an attacker
 * who knows a password must not be able to replace an existing authenticator.
 */

export interface ForcedEnrollmentCredentials {
  email: string;
  password: string;
  userType: 'internal' | 'client';
  tenant?: string;
  portalDomain?: string;
  captchaToken?: string;
}

export type ForcedEnrollmentErrorCode =
  | 'invalid_credentials'
  | 'enrollment_not_required'
  | 'invalid_code'
  | 'rate_limited'
  | 'captcha_required'
  | 'unavailable';

export interface BeginForcedEnrollmentResult {
  success: boolean;
  error?: ForcedEnrollmentErrorCode;
  secret?: string;
  qrDataUrl?: string;
}

export interface CompleteForcedEnrollmentResult {
  success: boolean;
  error?: ForcedEnrollmentErrorCode;
}

async function clientIpFromHeaders(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    return (forwarded ? forwarded.split(',')[0].trim() : h.get('x-real-ip')) || 'unknown';
  } catch {
    return 'unknown';
  }
}

type EligibilityResult =
  | { ok: true; user: IUser; attempt: { email: string; ip: string } }
  | { ok: false; error: ForcedEnrollmentErrorCode };

async function verifyEligibleForEnrollment(
  input: ForcedEnrollmentCredentials,
): Promise<EligibilityResult> {
  const {
    enforceLoginProtection,
    normalizeLoginEmail,
    recordLoginFailure,
    RateLimitedError,
    CaptchaRequiredError,
  } = await import('../../lib/security/loginProtection');
  const { resolvePasswordLoginDecision } = await import('../../lib/passwordLoginGate');

  const tenantSlug = input.tenant?.trim().toLowerCase() || undefined;
  if (tenantSlug && !isValidTenantSlug(tenantSlug)) {
    return { ok: false, error: 'invalid_credentials' };
  }
  const attempt = { email: normalizeLoginEmail(input.email), ip: await clientIpFromHeaders() };

  try {
    await enforceLoginProtection({ ...attempt, captchaToken: input.captchaToken });
  } catch (error) {
    if (error instanceof RateLimitedError) return { ok: false, error: 'rate_limited' };
    if (error instanceof CaptchaRequiredError) return { ok: false, error: 'captcha_required' };
    return { ok: false, error: 'unavailable' };
  }

  let user: IUser | null;
  try {
    // Password verification only; the login policy would (rightly) refuse this very user.
    user = await authenticateUser(input.email, input.password, input.userType, {
      tenantSlug,
      portalDomain: input.portalDomain?.trim().toLowerCase() || undefined,
      requireTenantMatch: Boolean(tenantSlug),
      purpose: 'reauthenticate',
    });
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (!user || user.user_type !== input.userType) {
    await recordLoginFailure(attempt);
    return { ok: false, error: 'invalid_credentials' };
  }

  try {
    const { decision } = await resolvePasswordLoginDecision(user);
    if (decision.outcome !== 'require-2fa-enrollment' || user.two_factor_enabled) {
      return { ok: false, error: 'enrollment_not_required' };
    }
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  return { ok: true, user, attempt };
}

export async function beginForcedTwoFactorEnrollment(
  input: ForcedEnrollmentCredentials,
): Promise<BeginForcedEnrollmentResult> {
  const eligible = await verifyEligibleForEnrollment(input);
  if ('error' in eligible) {
    return { success: false, error: eligible.error };
  }
  const { generateTotpEnrollment } = await import('../../lib/authenticator/authenticator');
  const material = await generateTotpEnrollment(eligible.user.email);
  return { success: true, secret: material.secret, qrDataUrl: material.qrDataUrl };
}

export async function completeForcedTwoFactorEnrollment(
  input: ForcedEnrollmentCredentials & { secret: string; code: string },
): Promise<CompleteForcedEnrollmentResult> {
  const { TOTP_SECRET_PATTERN, verifyAuthenticator } = await import(
    '../../lib/authenticator/authenticator'
  );
  if (!TOTP_SECRET_PATTERN.test(input.secret ?? '') || !/^\d{6}$/.test(input.code ?? '')) {
    return { success: false, error: 'invalid_code' };
  }
  const eligible = await verifyEligibleForEnrollment(input);
  if ('error' in eligible) {
    return { success: false, error: eligible.error };
  }
  if (!verifyAuthenticator(input.code, input.secret)) {
    const { recordLoginFailure } = await import('../../lib/security/loginProtection');
    await recordLoginFailure(eligible.attempt);
    return { success: false, error: 'invalid_code' };
  }

  const { user } = eligible;
  const knex = await getAdminConnection();
  const updated = await tenantDb(knex, user.tenant)
    .table('users')
    .where({ user_id: user.user_id })
    // Never overwrite an authenticator that appeared in the meantime.
    .andWhere((qb) => qb.whereNull('two_factor_enabled').orWhere('two_factor_enabled', false))
    .update({
      two_factor_enabled: true,
      two_factor_secret: input.secret,
      updated_at: knex.fn.now(),
    });
  if (!updated) {
    return { success: false, error: 'enrollment_not_required' };
  }

  const { recordForcedTwoFactorEnrollment } = await import('../../lib/authPolicyStore');
  await recordForcedTwoFactorEnrollment({
    tenant: user.tenant,
    userId: String(user.user_id),
    surface: 'two_factor_enrollment',
  });
  return { success: true };
}
