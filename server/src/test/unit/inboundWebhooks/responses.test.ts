import { describe, expect, it } from 'vitest';

import { unauthorizedInboundWebhookResponse } from '@/lib/inboundWebhooks/responses';

describe('inbound webhook responses', () => {
  it('should return a bare 401 with no body so callers cannot probe webhook existence', async () => {
    const response = unauthorizedInboundWebhookResponse();

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
  });
});
