import { describe, expect, it, vi } from 'vitest';

import { captureInboundWebhookSampleIfRequested } from '@/lib/inboundWebhooks/sampleCapture';

function createSampleCaptureKnex(updatedRows: number) {
  const nestedBuilder = {
    whereNull: vi.fn(),
  };
  const query = {
    where: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    andWhere: vi.fn((...args: unknown[]) => {
      if (typeof args[0] === 'function') {
        args[0](nestedBuilder);
      }
      return query;
    }),
    update: vi.fn().mockResolvedValue(updatedRows),
  };
  const knex = vi.fn().mockReturnValue(query) as any;
  knex.fn = {
    now: vi.fn(() => new Date('2026-05-11T12:00:00.000Z')),
  };

  return { knex, query, nestedBuilder };
}

describe('inbound webhook sample capture', () => {
  it('T080: stores the first verified body within an active capture window', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const body = { alert: { id: 'alert-123', message: 'Disk full' } };
    const { knex, query, nestedBuilder } = createSampleCaptureKnex(1);

    await expect(
      captureInboundWebhookSampleIfRequested({
        knex,
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        body,
        now,
      }),
    ).resolves.toBe(true);

    expect(knex).toHaveBeenCalledWith('inbound_webhooks');
    expect(query.where).toHaveBeenCalledWith('inbound_webhooks.tenant', 'tenant-a');
    expect(query.where).toHaveBeenCalledWith({
      inbound_webhook_id: 'webhook-1',
    });
    expect(query.whereNotNull).toHaveBeenCalledWith('sample_capture_expires_at');
    expect(query.andWhere).toHaveBeenCalledWith('sample_capture_expires_at', '>', now);
    expect(nestedBuilder.whereNull).toHaveBeenCalledWith('sample_payload');
    expect(query.update).toHaveBeenCalledWith({
      sample_payload: body,
      sample_capture_expires_at: null,
      updated_at: new Date('2026-05-11T12:00:00.000Z'),
    });
  });

  it('T081: returns false when the capture window has expired and does not overwrite a sample', async () => {
    const now = new Date('2026-05-11T12:06:00.000Z');
    const body = { alert: { id: 'alert-456', message: 'Late payload' } };
    const { knex, query, nestedBuilder } = createSampleCaptureKnex(0);

    await expect(
      captureInboundWebhookSampleIfRequested({
        knex,
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        body,
        now,
      }),
    ).resolves.toBe(false);

    expect(query.where).toHaveBeenCalledWith('inbound_webhooks.tenant', 'tenant-a');
    expect(query.where).toHaveBeenCalledWith({
      inbound_webhook_id: 'webhook-1',
    });
    expect(query.andWhere).toHaveBeenCalledWith('sample_capture_expires_at', '>', now);
    expect(nestedBuilder.whereNull).toHaveBeenCalledWith('sample_payload');
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sample_payload: body,
        sample_capture_expires_at: null,
      }),
    );
  });
});
