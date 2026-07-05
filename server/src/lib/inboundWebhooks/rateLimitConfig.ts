import type { BucketConfig } from '@alga-psa/core/rateLimit';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import { tenantDb } from '@alga-psa/db';
import { getConnection } from '@/lib/db/db';

export const INBOUND_WEBHOOK_RATE_LIMIT_NAMESPACE = 'webhook-in';
export const DEFAULT_INBOUND_WEBHOOK_RATE_LIMIT_PER_MIN = 600;

export const DEFAULT_INBOUND_WEBHOOK_RATE_LIMIT_CONFIG: BucketConfig = {
  maxTokens: DEFAULT_INBOUND_WEBHOOK_RATE_LIMIT_PER_MIN,
  refillRate: DEFAULT_INBOUND_WEBHOOK_RATE_LIMIT_PER_MIN / 60,
};

export async function inboundWebhookRateLimitConfigGetter(
  tenantId: string,
  inboundWebhookId?: string,
): Promise<BucketConfig> {
  if (!inboundWebhookId) {
    return DEFAULT_INBOUND_WEBHOOK_RATE_LIMIT_CONFIG;
  }

  const knex = await getConnection(tenantId);
  const row = await tenantDb(knex, tenantId).table('inbound_webhooks')
    .where({ inbound_webhook_id: inboundWebhookId })
    .first<{ rate_limit_per_minute: number }>('rate_limit_per_minute');
  const ratePerMinute = row?.rate_limit_per_minute ?? DEFAULT_INBOUND_WEBHOOK_RATE_LIMIT_PER_MIN;

  return {
    maxTokens: ratePerMinute,
    refillRate: ratePerMinute / 60,
  };
}

export async function checkInboundWebhookRateLimit(
  tenantId: string,
  inboundWebhookId: string,
): Promise<Awaited<ReturnType<TokenBucketRateLimiter['tryConsume']>>> {
  return TokenBucketRateLimiter.getInstance().tryConsume(
    INBOUND_WEBHOOK_RATE_LIMIT_NAMESPACE,
    tenantId,
    inboundWebhookId,
  );
}
