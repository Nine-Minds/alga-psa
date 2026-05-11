import { featureFlags, type FeatureFlagContext } from '@/lib/feature-flags/featureFlags';

export const INBOUND_WEBHOOKS_FEATURE_FLAG = 'inbound_webhooks_enabled';

export async function isInboundWebhooksEnabled(context: FeatureFlagContext = {}): Promise<boolean> {
  return featureFlags.isEnabled(INBOUND_WEBHOOKS_FEATURE_FLAG, context);
}
