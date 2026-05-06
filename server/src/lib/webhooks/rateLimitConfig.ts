import type { BucketConfig } from '@alga-psa/email';

import { webhookModel } from './webhookModel';

export const DEFAULT_WEBHOOK_RATE_LIMIT_PER_MIN = 100;

export const DEFAULT_WEBHOOK_RATE_LIMIT_CONFIG: BucketConfig = {
  maxTokens: DEFAULT_WEBHOOK_RATE_LIMIT_PER_MIN,
  refillRate: DEFAULT_WEBHOOK_RATE_LIMIT_PER_MIN / 60,
};

export async function webhookRateLimitConfigGetter(
  tenantId: string,
  webhookId?: string,
): Promise<BucketConfig> {
  if (!webhookId) {
    return DEFAULT_WEBHOOK_RATE_LIMIT_CONFIG;
  }

  const webhook = await webhookModel.getById(webhookId, tenantId);
  const ratePerMinute = webhook?.rateLimitPerMin ?? DEFAULT_WEBHOOK_RATE_LIMIT_PER_MIN;

  return {
    maxTokens: ratePerMinute,
    refillRate: ratePerMinute / 60,
  };
}

