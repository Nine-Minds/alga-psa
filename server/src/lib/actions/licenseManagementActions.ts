'use server';

import { getSession } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  getLicenseStateRow,
  upsertLicenseState,
  resolveSelfHostTier,
  type ResolvedLicenseState,
  type LicenseStateKind,
} from '@alga-psa/licensing';
import { verifyLicense } from '@alga-psa/licensing';

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
}

async function assertAdminPermission(): Promise<void> {
  const session = await getSession();
  const user = session?.user;
  if (!user) throw new Error('Unauthorized');
  const allowed = await hasPermission(user as any, 'account_management', 'read');
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
    return { selfHostMode: false, state: null, tier: null, expiresAt: null, daysRemaining: null, customer: null, trialUsed: false };
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
