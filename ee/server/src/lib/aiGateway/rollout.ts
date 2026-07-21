import { FeatureFlags } from '@alga-psa/core/server';

/**
 * Per-tenant rollout gate for AI usage billing (plan §9): flagged tenants
 * route AI traffic through the gateway; unflagged tenants keep the legacy
 * free direct-provider behavior. `AI_GATEWAY_ROLLOUT_ALL=true` short-circuits
 * the flag for dev/test environments without PostHog.
 */
const AI_USAGE_BILLING_FLAG = 'ai-usage-billing';

let flags: FeatureFlags | null = null;

function getFlags(): FeatureFlags {
  if (!flags) {
    flags = new FeatureFlags();
  }
  return flags;
}

export async function isAiUsageBillingEnabled(tenantId: string): Promise<boolean> {
  if (process.env.AI_GATEWAY_ROLLOUT_ALL === 'true') {
    return true;
  }
  try {
    return await getFlags().isEnabled(AI_USAGE_BILLING_FLAG, { tenantId });
  } catch {
    // Flag evaluation failure falls back to legacy (non-gateway) behavior.
    return false;
  }
}
