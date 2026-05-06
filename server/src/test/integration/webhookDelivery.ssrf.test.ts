import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const undiciState = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  agentClose: vi.fn(async () => undefined),
}));

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => undiciState.fetchMock(...args),
  Agent: class FakeAgent {
    close = undiciState.agentClose;
  },
}));

import { performWebhookDeliveryRequest } from '@/lib/webhooks/delivery';

describe('webhookDelivery SSRF guard at the delivery seam (T031)', () => {
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  beforeEach(() => {
    delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    undiciState.fetchMock.mockReset();
    undiciState.agentClose.mockReset();
  });

  afterEach(() => {
    if (originalAllowPrivate === undefined) {
      delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    } else {
      process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
    }
  });

  it('blocks http://127.0.0.1 before any socket is opened (undici.fetch not invoked, error_type=ssrf)', async () => {
    const result = await performWebhookDeliveryRequest({
      webhook_id: 'webhook-1',
      url: 'http://127.0.0.1',
      method: 'POST',
      headers: {},
      payload: { hello: 'world' },
      verify_ssl: true,
    });

    expect(undiciState.fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error_type).toBe('ssrf');
  });

  it('with WEBHOOK_SSRF_ALLOW_PRIVATE=true the same URL is accepted and undici.fetch is invoked', async () => {
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    undiciState.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      async text() {
        return '{}';
      },
    });

    const result = await performWebhookDeliveryRequest({
      webhook_id: 'webhook-1',
      url: 'http://127.0.0.1',
      method: 'POST',
      headers: {},
      payload: { hello: 'world' },
      verify_ssl: true,
    });

    expect(undiciState.fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = undiciState.fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://127.0.0.1');
    expect(result.success).toBe(true);
    expect(result.status_code).toBe(200);
  });
});
