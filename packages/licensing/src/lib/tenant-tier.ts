/**
 * Resolves a tenant's effective tier from persisted state alone.
 *
 * Deliberately session-free: tier gating has to be answerable from a request
 * (server actions, API guards) *and* from headless runtimes that never see a
 * session — the Temporal worker deciding whether a tenant keeps its recurring
 * schedules, for one. Both call this so a feature can't be Pro on the screen
 * and Enterprise-only in the scheduler.
 */
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { type TenantTier, resolveTier } from '@alga-psa/types';
import { getLicenseStateRow, resolveSelfHostTier } from './license-state';

export function hasActiveSoloProTrial(value?: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

/**
 * The tenant's effective tier, ignoring edition. Callers that must not gate on
 * CE (where every compiled-in feature is available) check the edition first.
 */
export async function resolveTenantTier(tenantId: string): Promise<TenantTier> {
  // Self-host mode: a license_state row supersedes tenants.plan (offline
  // license / trial / 'essentials' floor). Guard against the table not existing
  // yet (rolling deploy hitting an un-migrated DB) — fall through to the SaaS
  // plan/Stripe resolution rather than failing the caller.
  try {
    // Pass the request's tenant so a tenant-bound license that was issued for a
    // different install resolves to essentials (license_wrong_tenant) instead of
    // unlocking its tier here.
    const selfHost = resolveSelfHostTier(await getLicenseStateRow(), tenantId);
    if (selfHost !== null) {
      return selfHost.tier;
    }
  } catch {
    // license_state unavailable; fall through to plan/Stripe resolution.
  }

  const knex = await getAdminConnection();
  const tenantRecord = await tenantDb(knex, tenantId).table('tenants')
    .select('plan')
    .first();

  const resolvedTier = resolveTier(tenantRecord?.plan).tier;
  if (resolvedTier !== 'solo') {
    return resolvedTier;
  }

  const subscription = await tenantDb(knex, tenantId).table('stripe_subscriptions')
    .whereIn('status', ['active', 'trialing', 'past_due', 'unpaid'])
    .orderByRaw("CASE WHEN status = 'trialing' THEN 0 WHEN status = 'active' THEN 1 ELSE 2 END")
    .select('metadata')
    .first();

  if (
    subscription?.metadata?.solo_pro_trial === 'true'
    && hasActiveSoloProTrial(subscription.metadata.solo_pro_trial_end)
  ) {
    return 'pro';
  }

  return resolvedTier;
}
