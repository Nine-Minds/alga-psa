import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractInboundWebhookIdempotencyKey, findDuplicateInboundDelivery } from '@/lib/inboundWebhooks/idempotency';

function createDuplicateLookupKnex(row: Record<string, unknown> | null) {
  const calls = {
    table: vi.fn(),
    where: vi.fn(),
    whereIn: vi.fn(),
    orderBy: vi.fn(),
    first: vi.fn(),
  };
  const query = {
    where: calls.where.mockReturnThis(),
    whereIn: calls.whereIn.mockReturnThis(),
    orderBy: calls.orderBy.mockReturnThis(),
    first: calls.first.mockResolvedValue(row),
  };
  const knex = calls.table.mockReturnValue(query);

  return { knex, calls };
}

describe('inbound webhook idempotency', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('T051: extracts a JSONata-source idempotency key from the request body', async () => {
    await expect(
      extractInboundWebhookIdempotencyKey({
        source: { type: 'jsonata', value: 'alert.id' },
        headers: new Headers(),
        body: {
          alert: {
            id: ' alert-789 ',
          },
        },
      }),
    ).resolves.toBe('alert-789');
  });

  it('T053: treats the same idempotency key after the window as a fresh dispatch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-11T12:00:00.000Z').getTime());
    const { knex, calls } = createDuplicateLookupKnex(null);

    const duplicate = await findDuplicateInboundDelivery({
      knex: knex as any,
      tenant: 'tenant-a',
      inboundWebhookId: 'webhook-1',
      idempotencyKey: 'alert-123',
      windowSeconds: 60,
    });

    expect(duplicate).toBeNull();
    expect(calls.table).toHaveBeenCalledWith('inbound_webhook_deliveries');
    expect(calls.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      inbound_webhook_id: 'webhook-1',
      idempotency_key: 'alert-123',
    });
    expect(calls.where).toHaveBeenCalledWith('received_at', '>=', new Date('2026-05-11T11:59:00.000Z'));
    expect(calls.whereIn).toHaveBeenCalledWith('dispatch_status', ['pending', 'dispatched', 'duplicate']);
    expect(calls.orderBy).toHaveBeenCalledWith('received_at', 'desc');
  });

  it('T055: scopes duplicate idempotency checks to the current webhook', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-11T12:00:00.000Z').getTime());
    const { knex, calls } = createDuplicateLookupKnex(null);

    const duplicate = await findDuplicateInboundDelivery({
      knex: knex as any,
      tenant: 'tenant-a',
      inboundWebhookId: 'webhook-b',
      idempotencyKey: 'shared-alert-key',
      windowSeconds: 86_400,
    });

    expect(duplicate).toBeNull();
    expect(calls.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      inbound_webhook_id: 'webhook-b',
      idempotency_key: 'shared-alert-key',
    });
    expect(calls.where).not.toHaveBeenCalledWith(
      expect.objectContaining({
        inbound_webhook_id: 'webhook-a',
        idempotency_key: 'shared-alert-key',
      }),
    );
  });
});
