import { describe, expect, it } from 'vitest';

import { extractInboundWebhookIdempotencyKey } from '@/lib/inboundWebhooks/idempotency';

describe('inbound webhook idempotency', () => {
  it('T050: extracts a header-source idempotency key from the configured header', async () => {
    await expect(
      extractInboundWebhookIdempotencyKey({
        source: { type: 'header', value: 'X-Idempotency-Key' },
        headers: new Headers({
          'x-idempotency-key': '  alert-123  ',
        }),
        body: { ignored: true },
      }),
    ).resolves.toBe('alert-123');

    await expect(
      extractInboundWebhookIdempotencyKey({
        source: { type: 'header', value: 'X-Idempotency-Key' },
        headers: {
          'x-idempotency-key': [' alert-456 ', 'ignored-second-value'],
        },
        body: { ignored: true },
      }),
    ).resolves.toBe('alert-456');
  });
});
