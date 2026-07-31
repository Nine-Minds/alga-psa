import { describe, expect, it, vi } from 'vitest';

import { createInboundDelivery } from '@/lib/inboundWebhooks/deliveryPersistence';

function createInsertKnex() {
  const now = new Date('2026-05-11T12:00:00.000Z');
  const builder = {
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ delivery_id: 'delivery-1' }]),
  };
  const knex = vi.fn().mockReturnValue(builder) as any;
  knex.fn = {
    now: vi.fn(() => now),
  };

  return { knex, builder, now };
}

describe('inbound webhook delivery persistence', () => {
  it('T061: logs auth-rejected requests with limited detail and no request body', async () => {
    const { knex, builder } = createInsertKnex();

    await expect(
      createInboundDelivery(knex, {
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        idempotencyKey: 'alert-123',
        requestMethod: 'POST',
        requestPath: '/api/inbound/tenant-slug/rmm-alerts',
        requestHeaders: {
          authorization: 'Bearer wrong-token',
          cookie: 'session=secret',
          'content-type': 'application/json',
          'x-request-id': 'request-1',
        },
        requestBody: { alert: { message: 'sensitive body' } },
        sourceIp: '203.0.113.10',
        userAgent: 'vitest',
        authStatus: 'rejected_bearer',
        responseStatus: 401,
      }),
    ).resolves.toEqual({ deliveryId: 'delivery-1' });

    expect(knex).toHaveBeenCalledWith('inbound_webhook_deliveries');
    expect(builder.where).toHaveBeenCalledWith('inbound_webhook_deliveries.tenant', 'tenant-a');
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-a',
        inbound_webhook_id: 'webhook-1',
        idempotency_key: 'alert-123',
        request_method: 'POST',
        request_path: '/api/inbound/tenant-slug/rmm-alerts',
        request_headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-1',
        },
        request_body: null,
        source_ip: '203.0.113.10',
        user_agent: 'vitest',
        auth_status: 'rejected_bearer',
        dispatch_status: 'pending',
        response_status: 401,
      }),
    );
  });

  it('T162: persists replay deliveries with replay linkage metadata', async () => {
    const { knex, builder } = createInsertKnex();

    await expect(
      createInboundDelivery(knex, {
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        idempotencyKey: 'alert-123',
        requestMethod: 'POST',
        requestPath: '/api/inbound/tenant-slug/rmm-alerts',
        requestHeaders: {
          'content-type': 'application/json',
        },
        requestBody: { alert: { message: 'CPU high' } },
        sourceIp: '203.0.113.10',
        userAgent: 'vitest',
        authStatus: 'verified',
        isReplay: true,
        replayedFrom: 'delivery-original',
      }),
    ).resolves.toEqual({ deliveryId: 'delivery-1' });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-a',
        inbound_webhook_id: 'webhook-1',
        auth_status: 'verified',
        is_replay: true,
        replayed_from: 'delivery-original',
      }),
    );
  });
});
