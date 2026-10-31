'use server';

import { getCurrentUser, localizeActionError } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  isActionPermissionError,
  permissionError,
  type ActionPermissionErrorShape,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getLicenseStateRow,
  upsertLicenseState,
  applyCheckInResult,
  interpretCheckInResponse,
  resolveSelfHostTier,
  isLicenseVerifyFailure,
  type ResolvedLicenseState,
  type LicenseStateKind,
} from '@alga-psa/licensing';
import { verifyLicense } from '@alga-psa/licensing';
import crypto from 'node:crypto';

export interface LicenseStatus {
  /** Whether a license_state row exists (self-host mode). */
  selfHostMode: boolean;
  state: LicenseStateKind | null;
  tier: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  /** Customer name from the current license, if any. */
  customer: string | null;
  /** True if the install has already used its one-time trial. */
  trialUsed: boolean;
  /** Connected-appliance status */
  connected: boolean;
  lastCheckinAt: string | null;
  /**
   * This install's tenant UUID. Shown on the License page so a customer can
   * supply it when purchasing an air-gapped/manual license — the issuer binds
   * the key to this tenant (its `aud`) so it can't be reused on another install.
   */
  tenantId: string | null;
  /**
   * Cancelled-subscription context from the last check-in, or null. 'ending' =
   * still licensed, Pro ends at `endsAt`; 'lapsed' = Pro already ended and the
   * install is on the free edition. Dates are ISO strings.
   */
  subscription: LicenseSubscriptionStatus | null;
}

export interface LicenseSubscriptionStatus {
  /** 'payment_failed' = still Pro, renewal payment failing while Stripe retries. */
  phase: 'ending' | 'lapsed' | 'payment_failed';
  /**
   * 'term' = a fixed-term grant reaching its planned end — not a cancellation.
   * 'payment_failed' = failing payments (while retrying, or the end that followed).
   */
  cause: 'cancelled' | 'term' | 'payment_failed';
  endsAt: string | null;
  resubscribeUrl: string | null;
  /** `payment_failed` phase only; ISO string, null when no retry is scheduled. */
  nextRetryAt?: string | null;
  /** `payment_failed` phase only: where to update the payment method. */
  updatePaymentUrl?: string | null;
}

type LicenseAdminUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
/**
 * `code` lets the UI localize the two check-in failures that need distinct
 * wording: a soft subscription lapse vs a hard-revoked appliance credential.
 * `error` always carries an English fallback.
 */
export type LicenseMutationCode = 'subscription_lapsed' | 'credential_revoked';
type LicenseMutationResult = { success: boolean; error?: string; code?: LicenseMutationCode; status?: LicenseStatus };
export type LicenseStatusResult = LicenseStatus | ActionPermissionErrorShape;

async function assertAdminPermission(): Promise<LicenseAdminUser | ActionPermissionErrorShape> {
  // Must use getCurrentUser (returns a full IUserWithRoles with user_id) — the
  // raw NextAuth session.user exposes `id`, not `user_id`, and hasPermission
  // binds user_roles.user_id, so passing session.user yields an undefined-binding
  // SQL error rather than a permission check.
  // Localized here rather than at withAuth: these actions run their own guard, so
  // the payload never passes through the wrapper that would otherwise translate it.
  const user = await getCurrentUser();
  if (!user) return localizeActionError(permissionError('Unauthorized. Sign in to manage licensing.', 'msp/licensing:errors.notSignedIn'));
  const allowed = await hasPermission(user, 'account_management', 'read');
  if (!allowed) return localizeActionError(permissionError('Permission denied: account_management read required', 'msp/licensing:errors.accountManagementRead'));
  // Returned so callers can bind license checks to this install's tenant.
  return user;
}

function permissionFailureResult(error: ActionPermissionErrorShape): LicenseMutationResult {
  return { success: false, error: error.permissionError };
}

async function getLicenseStatusForUser(user: LicenseAdminUser): Promise<LicenseStatus> {
  const row = await getLicenseStateRow();
  if (!row) {
    return { selfHostMode: false, state: null, tier: null, expiresAt: null, daysRemaining: null, customer: null, trialUsed: false, connected: false, lastCheckinAt: null, tenantId: user.tenant ?? null, subscription: null };
  }

  // Pass the tenant so a tenant-bound license issued for a different install
  // surfaces as license_wrong_tenant rather than reporting its tier.
  const resolved: ResolvedLicenseState = resolveSelfHostTier(row, user.tenant)!;
  let customer: string | null = null;
  if (row.license_token) {
    const v = verifyLicense(row.license_token);
    if (v.valid) customer = v.claims.cust;
  }

  return {
    selfHostMode: true,
    state: resolved.state,
    tier: resolved.tier,
    expiresAt: resolved.expiresAt?.toISOString() ?? null,
    daysRemaining: resolved.daysRemaining,
    customer,
    trialUsed: row.trial_started_at !== null,
    connected: !!(row.appliance_credential && row.check_in_url),
    lastCheckinAt: row.last_checkin_at?.toISOString() ?? null,
    tenantId: user.tenant ?? null,
    subscription: resolved.subscription
      ? {
          phase: resolved.subscription.phase,
          cause: resolved.subscription.cause,
          endsAt: resolved.subscription.endsAt?.toISOString() ?? null,
          resubscribeUrl: resolved.subscription.resubscribeUrl,
          ...(resolved.subscription.phase === 'payment_failed'
            ? {
                nextRetryAt: resolved.subscription.nextRetryAt?.toISOString() ?? null,
                updatePaymentUrl: resolved.subscription.updatePaymentUrl ?? null,
              }
            : {}),
        }
      : null,
  };
}

/**
 * Returns the current license status for self-hosted installs.
 * In SaaS mode (no license_state row) returns { selfHostMode: false }.
 */
export async function getLicenseStatus(): Promise<LicenseStatusResult> {
  const user = await assertAdminPermission();
  if (isActionPermissionError(user)) {
    return user;
  }
  return getLicenseStatusForUser(user);
}

/**
 * Verifies and stores a signed license token.
 * Rejects invalid/expired/wrong-kid tokens.
 */
export async function submitLicense(token: string): Promise<LicenseMutationResult> {
  const user = await assertAdminPermission();
  if (isActionPermissionError(user)) {
    return permissionFailureResult(user);
  }

  const result = verifyLicense(token.trim());
  if (isLicenseVerifyFailure(result)) {
    return { success: false, error: `License is invalid: ${result.reason}` };
  }
  if (result.claims.exp * 1000 <= Date.now()) {
    return { success: false, error: 'License has already expired' };
  }
  // Per-tenant binding: refuse a license bound (via `aud`) to a different tenant
  // before it is ever stored. Unbound licenses (no `aud`) activate anywhere.
  if (result.claims.aud && result.claims.aud !== user.tenant) {
    return { success: false, error: 'This license was issued for a different tenant and cannot be activated on this appliance.' };
  }

  await upsertLicenseState({ license_token: token.trim() });

  const status = await getLicenseStatusForUser(user);
  return { success: true, status };
}

/**
 * Starts the one-time 15-day Enterprise trial.
 * Blocked if: trial already used, or a valid license is already active.
 */
export async function startTrial(): Promise<LicenseMutationResult> {
  const user = await assertAdminPermission();
  if (isActionPermissionError(user)) {
    return permissionFailureResult(user);
  }

  const row = await getLicenseStateRow();
  if (!row) return { success: false, error: 'Not a self-hosted install' };

  if (row.trial_started_at !== null) {
    return { success: false, error: 'Trial has already been used for this install' };
  }

  const resolved = resolveSelfHostTier(row, user.tenant);
  if (resolved?.state === 'licensed') {
    return { success: false, error: 'A valid license is already active' };
  }

  await upsertLicenseState({ trial_started_at: new Date(), edition_choice: 'ee' });

  const status = await getLicenseStatusForUser(user);
  return { success: true, status };
}

/**
 * Immediately check in with the alga-license service and store any re-signed
 * license. The daily check-in does this on its own schedule; this action backs
 * the License page's "Refresh license now" button so a seat or tier change made
 * in the customer portal takes effect right away (the service re-signs whenever
 * the held token no longer matches the entitlement).
 */
export async function refreshLicenseNow(): Promise<LicenseMutationResult> {
  const user = await assertAdminPermission();
  if (isActionPermissionError(user)) {
    return permissionFailureResult(user);
  }

  const row = await getLicenseStateRow();
  if (!row) return { success: false, error: 'Not a self-hosted install' };
  if (!row.appliance_credential || !row.check_in_url) {
    return { success: false, error: 'This appliance is not connected for automatic refresh. Activate a claim code first.' };
  }

  let currentLicenseSub: string | undefined;
  if (row.license_token) {
    const v = verifyLicense(row.license_token);
    if (v.valid) currentLicenseSub = v.claims.sub;
  }

  try {
    const res = await fetch(row.check_in_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appliance_credential: row.appliance_credential, current_license_sub: currentLicenseSub }),
    });

    // Parsing + persistence is shared with the daily Temporal check-in so the two
    // callers cannot drift (subscription context, soft-revocation grace).
    const body: unknown = await res.json().catch(() => undefined);
    const result = interpretCheckInResponse(res.status, body);

    switch (result.kind) {
      case 'credential_revoked':
        // Hard revocation (401 revoked_appliance): rebind/compromise, NOT a lapsed
        // subscription. The stored token is left alone (it grace-expires).
        return {
          success: false,
          code: 'credential_revoked',
          error: "This appliance's license credential was revoked. Connect it again with a new claim code from the licensing portal.",
        };
      case 'server_error':
      case 'rejected':
        return { success: false, error: `License service returned HTTP ${result.httpStatus}. Try again shortly.` };
      case 'lapsed': {
        // Soft lapse: persist the context but keep the stored token — it keeps
        // Pro until its own exp (never hard-cut on 'revoked').
        await applyCheckInResult(result, row);
        const status = await getLicenseStatusForUser(user);
        return { success: false, code: 'subscription_lapsed', error: lapseMessage(status), status };
      }
      default:
        await applyCheckInResult(result, row);
        return { success: true, status: await getLicenseStatusForUser(user) };
    }
  } catch (err) {
    return { success: false, error: 'License refresh failed. Try again shortly.' };
  }
}

/** English fallback for the soft-lapse refresh result; the UI localizes via `code`. */
function lapseMessage(status: LicenseStatus): string {
  const sub = status.subscription;
  const endsAt = sub?.endsAt ?? status.expiresAt;
  const date = endsAt ? new Date(endsAt).toISOString().slice(0, 10) : null;
  const head = sub?.phase === 'lapsed' || status.tier === 'essentials'
    ? "The Pro subscription has ended and this appliance is on the free edition."
    : `The Pro subscription has been cancelled. Pro ends${date ? ` on ${date}` : ''}.`;
  return sub?.resubscribeUrl ? `${head} Resubscribe at ${sub.resubscribeUrl}.` : `${head} Resubscribe to restore Pro.`;
}

/**
 * Redeems a one-time claim code against the alga-license service.
 * Stores the per-appliance credential and the first JWT in license_state.
 * Called by the in-app License page "Connect this appliance" flow (C5).
 */
export async function connectAppliance(
  claimCode: string
): Promise<LicenseMutationResult> {
  const user = await assertAdminPermission();
  if (isActionPermissionError(user)) {
    return permissionFailureResult(user);
  }

  const row = await getLicenseStateRow();
  if (!row) return { success: false, error: 'Not a self-hosted install' };

  const serviceUrl = process.env.ALGA_LICENSE_SERVICE_URL;
  if (!serviceUrl) return { success: false, error: 'License service URL not configured' };

  // Re-registration must retain the appliance identity and credential lineage.
  // LEVERAGE: pattern license-state-writers — keep this identity resolution in
  // sync with the appliance Temporal redemption activity.
  const applianceId = row.appliance_id
    ?? `appliance-${row.id}-${crypto.createHash('sha256').update(String(row.id)).digest('hex').slice(0, 8)}`;

  try {
    // Send tenant_id so the alga-license service can bind the issued JWT (its
    // `aud` claim) to this install's tenant.
    const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim_code: claimCode.trim().toUpperCase(), appliance_id: applianceId, tenant_id: user.tenant }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' })) as { error?: string; code?: string };
      const codeMap: Record<string, string> = {
        invalid_claim_code: 'Invalid claim code. Check the code and try again.',
        expired_claim_code: 'Claim code has expired. Request a new one from the portal.',
        consumed_claim_code: 'Claim code has already been used.',
      };
      return { success: false, error: codeMap[body.code ?? ''] ?? 'Registration failed. Check the claim code and try again.' };
    }

    const { appliance_credential, first_jwt, check_in_url } = await res.json() as {
      appliance_credential: string;
      first_jwt: string;
      check_in_url: string;
    };

    // Store the plaintext credential in the DB (high-entropy 64-hex random bytes;
    // DB access-controlled; needed in plaintext by the daily refresh route to
    // authenticate check-in calls to the alga-license service).
    await upsertLicenseState({
      license_token: first_jwt,
      appliance_id: applianceId,
      check_in_url: check_in_url,
      appliance_credential: appliance_credential,
      last_checkin_at: new Date(),
    } as any);

    const status = await getLicenseStatusForUser(user);
    return { success: true, status };
  } catch (err) {
    return { success: false, error: 'Connection failed. Check the claim code and try again.' };
  }
}
