// server/src/lib/tier-gating/assertTierAccess.ts

import {
  type TIER_FEATURES,
  FEATURE_MINIMUM_TIER,
  type TenantTier,
  resolveTier,
  tierHasFeature,
  TIER_LABELS,
} from '@alga-psa/types';
import { getSession } from '@alga-psa/auth';
import { getAdminConnection } from '@alga-psa/db/admin';
import { isEnterprise } from '../features';

export class TierAccessError extends Error {
  public readonly feature: TIER_FEATURES;
  public readonly requiredTier: string;
  public readonly currentTier: string;
  public readonly statusCode = 403;
  public readonly code = 'TIER_ACCESS_DENIED';

  constructor(feature: TIER_FEATURES, requiredTier: string, currentTier: string) {
    const requiredLabel = TIER_LABELS[requiredTier as keyof typeof TIER_LABELS] || requiredTier;
    super(`This feature requires the ${requiredLabel} plan or higher.`);
    this.name = 'TierAccessError';
    this.feature = feature;
    this.requiredTier = requiredTier;
    this.currentTier = currentTier;
  }
}

/**
 * Server-side assertion that throws if the current tenant doesn't have access to a feature.
 * Use this in server actions to gate functionality by tier.
 *
 * @example
 * async function syncEntraTenants() {
 *   'use server';
 *   await assertTierAccess(TIER_FEATURES.ENTRA_SYNC);
 *   // ... rest of the action
 * }
 */
export async function assertTierAccess(feature: TIER_FEATURES): Promise<void> {
  // CE edition: no tier restrictions on compiled-in features
  if (!isEnterprise) return;

  const session = await getSession();
  const plan = session?.user?.plan;
  const { tier } = resolveTier(plan);
  const effectiveTier = tier === 'solo' && hasActiveSoloProTrial(session?.user?.solo_pro_trial_end)
    ? 'pro'
    : tier;

  if (!tierHasFeature(effectiveTier, feature)) {
    const requiredTier = FEATURE_MINIMUM_TIER[feature];
    throw new TierAccessError(feature, requiredTier, effectiveTier);
  }
}

function hasActiveSoloProTrial(value?: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

async function getTenantTier(tenantId: string): Promise<TenantTier> {
  const knex = await getAdminConnection();
  const tenantRecord = await knex('tenants')
    .where({ tenant: tenantId })
    .select('plan')
    .first();

  const resolvedTier = resolveTier(tenantRecord?.plan).tier;
  if (resolvedTier !== 'solo') {
    return resolvedTier;
  }

  const subscription = await knex('stripe_subscriptions')
    .where({ tenant: tenantId })
    .whereIn('status', ['active', 'trialing', 'past_due', 'unpaid'])
    .orderByRaw("CASE WHEN status = 'trialing' THEN 0 WHEN status = 'active' THEN 1 ELSE 2 END")
    .select('metadata')
    .first();

  if (subscription?.metadata?.solo_pro_trial === 'true' && hasActiveSoloProTrial(subscription.metadata.solo_pro_trial_end)) {
    return 'pro';
  }

  return resolvedTier;
}

export async function assertTenantTierAccess(tenantId: string, feature: TIER_FEATURES): Promise<void> {
  if (!isEnterprise) return;

  const tier = await getTenantTier(tenantId);

  if (!tierHasFeature(tier, feature)) {
    const requiredTier = FEATURE_MINIMUM_TIER[feature];
    throw new TierAccessError(feature, requiredTier, tier);
  }
}
