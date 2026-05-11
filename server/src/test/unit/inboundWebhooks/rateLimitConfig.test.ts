import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMocks = vi.hoisted(() => ({
  tryConsume: vi.fn(),
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: vi.fn(() => ({
      tryConsume: rateLimitMocks.tryConsume,
    })),
  },
}));

import {
  checkInboundWebhookRateLimit,
  INBOUND_WEBHOOK_RATE_LIMIT_NAMESPACE,
} from '@/lib/inboundWebhooks/rateLimitConfig';

describe('inbound webhook rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMocks.tryConsume.mockResolvedValue({ allowed: true });
  });

  it('T071: isolates token buckets per webhook', async () => {
    await checkInboundWebhookRateLimit('tenant-a', 'webhook-a');
    await checkInboundWebhookRateLimit('tenant-a', 'webhook-b');

    expect(rateLimitMocks.tryConsume).toHaveBeenNthCalledWith(
      1,
      INBOUND_WEBHOOK_RATE_LIMIT_NAMESPACE,
      'tenant-a',
      'webhook-a',
    );
    expect(rateLimitMocks.tryConsume).toHaveBeenNthCalledWith(
      2,
      INBOUND_WEBHOOK_RATE_LIMIT_NAMESPACE,
      'tenant-a',
      'webhook-b',
    );
  });

});
