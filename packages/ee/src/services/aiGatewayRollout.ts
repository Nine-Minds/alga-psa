import { FeatureFlags } from '@alga-psa/core/server';

// LEVERAGE: pattern ai-gateway-rollout-check — duplicated from
// ee/server/src/lib/aiGateway/rollout.ts for the same reason the resolver is
// duplicated here; consolidate when the resolver moves to a shared package.
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
    return false;
  }
}
