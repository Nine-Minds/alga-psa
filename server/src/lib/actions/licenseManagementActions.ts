'use server';

import { getCurrentUser } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  getLicenseStateRow,
  upsertLicenseState,
  resolveSelfHostTier,
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
}

async function assertAdminPermission(): Promise<void> {
  // Must use getCurrentUser (returns a full IUserWithRoles with user_id) — the
  // raw NextAuth session.user exposes `id`, not `user_id`, and hasPermission
  // binds user_roles.user_id, so passing session.user yields an undefined-binding
  // SQL error rather than a permission check.
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const allowed = await hasPermission(user, 'account_management', 'read');
  if (!allowed) throw new Error('Forbidden: account_management permission required');
}

/**
 * Returns the current license status for self-hosted installs.
 * In SaaS mode (no license_state row) returns { selfHostMode: false }.
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  await assertAdminPermission();

  const row = await getLicenseStateRow();
  if (!row) {
    return { selfHostMode: false, state: null, tier: null, expiresAt: null, daysRemaining: null, customer: null, trialUsed: false, connected: false, lastCheckinAt: null };
  }

  const resolved: ResolvedLicenseState = resolveSelfHostTier(row)!;
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
  };
}

/**
 * Verifies and stores a signed license token.
 * Rejects invalid/expired/wrong-kid tokens.
 */
export async function submitLicense(token: string): Promise<{ success: boolean; error?: string; status?: LicenseStatus }> {
  await assertAdminPermission();

  const result = verifyLicense(token.trim());
  if (!result.valid) {
    return { success: false, error: `License is invalid: ${result.reason}` };
  }
  if (result.claims.exp * 1000 <= Date.now()) {
    return { success: false, error: 'License has already expired' };
  }

  await upsertLicenseState({ license_token: token.trim() });

  const status = await getLicenseStatus();
  return { success: true, status };
}

/**
 * Starts the one-time 30-day Enterprise trial.
 * Blocked if: trial already used, or a valid license is already active.
 */
export async function startTrial(): Promise<{ success: boolean; error?: string; status?: LicenseStatus }> {
  await assertAdminPermission();

  const row = await getLicenseStateRow();
  if (!row) return { success: false, error: 'Not a self-hosted install' };

  if (row.trial_started_at !== null) {
    return { success: false, error: 'Trial has already been used for this install' };
  }

  const resolved = resolveSelfHostTier(row);
  if (resolved?.state === 'licensed') {
    return { success: false, error: 'A valid license is already active' };
  }

  await upsertLicenseState({ trial_started_at: new Date(), edition_choice: 'ee' });

  const status = await getLicenseStatus();
  return { success: true, status };
}

/**
 * Redeems a one-time claim code against the alga-license service.
 * Stores the per-appliance credential and the first JWT in license_state.
 * Called by the in-app License page "Connect this appliance" flow (C5).
 */
export async function connectAppliance(
  claimCode: string
): Promise<{ success: boolean; error?: string; status?: LicenseStatus }> {
  await assertAdminPermission();

  const row = await getLicenseStateRow();
  if (!row) return { success: false, error: 'Not a self-hosted install' };

  const serviceUrl = process.env.ALGA_LICENSE_SERVICE_URL;
  if (!serviceUrl) return { success: false, error: 'License service URL not configured' };

  // Derive a stable install id from the existing license state id
  const applianceId = `appliance-${row.id}-${crypto.createHash('sha256').update(String(row.id)).digest('hex').slice(0, 8)}`;

  try {
    const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim_code: claimCode.trim().toUpperCase(), appliance_id: applianceId }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' })) as { error?: string; code?: string };
      const codeMap: Record<string, string> = {
        invalid_claim_code: 'Invalid claim code. Check the code and try again.',
        expired_claim_code: 'Claim code has expired. Request a new one from the portal.',
        consumed_claim_code: 'Claim code has already been used.',
      };
      return { success: false, error: codeMap[body.code ?? ''] ?? body.error ?? 'Registration failed' };
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

    const status = await getLicenseStatus();
    return { success: true, status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}
