import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WEBHOOK_ID = '22222222-2222-4222-8222-222222222222';

const getByIdMock = vi.hoisted(() => vi.fn());
const listRetryableDeliveriesMock = vi.hoisted(() => vi.fn());
const enqueueMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    getById: getByIdMock,
    listRetryableDeliveries: listRetryableDeliveriesMock,
  },
}));

vi.mock('@/lib/webhooks/WebhookDeliveryQueue', () => ({
  WebhookDeliveryQueue: {
    getInstance: () => ({ enqueue: enqueueMock }),
  },
}));

function buildDelivery(overrides: Record<string, unknown> = {}) {
  const eventId = (overrides.eventId as string | undefined) ?? '33333333-3333-4333-8333-333333333333';
  return {
    tenant: TENANT_ID,
    deliveryId: '44444444-4444-4444-8444-444444444444',
    webhookId: WEBHOOK_ID,
    eventId,
    eventType: 'ticket.updated',
    requestHeaders: null,
    requestBody: {
      event_id: eventId,
      event_type: 'ticket.updated',
      occurred_at: '2026-10-01T00:00:00.000Z',
      tenant_id: TENANT_ID,
      data: { ticket_id: '55555555-5555-4555-8555-555555555555' },
    },
    responseStatusCode: 500,
    responseHeaders: null,
    responseBody: null,
    status: 'failed',
    attemptNumber: 5,
    durationMs: 12,
    errorMessage: 'boom',
    nextRetryAt: null,
    isTest: false,
    attemptedAt: new Date('2026-10-01T00:00:00.000Z'),
    completedAt: null,
    ...overrides,
  } as any;
}

async function buildService() {
  const { WebhookService } = await import('@/lib/api/services/WebhookService');
  return new WebhookService(undefined as any, undefined as any, undefined as any);
}

describe('WebhookService.retryFailedDeliveries', () => {
  beforeEach(() => {
    getByIdMock.mockReset();
    getByIdMock.mockResolvedValue({ webhookId: WEBHOOK_ID, tenant: TENANT_ID });
    listRetryableDeliveriesMock.mockReset();
    enqueueMock.mockClear();
  });

  it('queues one retry per valid delivery and counts unusable payloads as skipped', async () => {
    listRetryableDeliveriesMock.mockResolvedValue({
      data: [
        buildDelivery({ eventId: '33333333-3333-4333-8333-333333333331' }),
        buildDelivery({
          eventId: '33333333-3333-4333-8333-333333333332',
          deliveryId: '44444444-4444-4444-8444-444444444442',
          requestBody: { nonsense: true },
        }),
      ],
      totalCandidates: 2,
    });

    const service = await buildService();
    const result = await service.retryFailedDeliveries(WEBHOOK_ID, TENANT_ID);

    expect(result.data).toEqual({
      queued: 1,
      skipped: 1,
      total_candidates: 2,
      truncated: false,
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0]![0]).toMatchObject({
      webhookId: WEBHOOK_ID,
      tenantId: TENANT_ID,
      eventId: '33333333-3333-4333-8333-333333333331',
      eventType: 'ticket.updated',
      attempt: 1,
    });
  });

  it('enqueues a repeatedly failed event only once', async () => {
    const eventId = '33333333-3333-4333-8333-333333333339';
    listRetryableDeliveriesMock.mockResolvedValue({
      data: [
        buildDelivery({ eventId, attemptNumber: 1 }),
        buildDelivery({ eventId, attemptNumber: 5, deliveryId: '44444444-4444-4444-8444-444444444449' }),
      ],
      totalCandidates: 2,
    });

    const service = await buildService();
    const result = await service.retryFailedDeliveries(WEBHOOK_ID, TENANT_ID);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({
      queued: 1,
      skipped: 1,
      total_candidates: 2,
      truncated: false,
    });
  });

  it('caps the batch at the hard maximum and flags truncation', async () => {
    listRetryableDeliveriesMock.mockResolvedValue({ data: [], totalCandidates: 4000 });

    const service = await buildService();
    const result = await service.retryFailedDeliveries(WEBHOOK_ID, TENANT_ID, { limit: 5000 });

    expect(listRetryableDeliveriesMock).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID, {
      since: undefined,
      limit: 1000,
    });
    expect(result.data.truncated).toBe(true);
  });

  it('defaults the limit to 500 and passes since through as a date', async () => {
    listRetryableDeliveriesMock.mockResolvedValue({ data: [], totalCandidates: 0 });

    const service = await buildService();
    const result = await service.retryFailedDeliveries(WEBHOOK_ID, TENANT_ID, {
      since: '2026-09-30T12:00:00.000Z',
    });

    expect(listRetryableDeliveriesMock).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID, {
      since: new Date('2026-09-30T12:00:00.000Z'),
      limit: 500,
    });
    expect(result.data).toEqual({
      queued: 0,
      skipped: 0,
      total_candidates: 0,
      truncated: false,
    });
  });

  it('404s when the webhook does not belong to the tenant', async () => {
    getByIdMock.mockResolvedValue(null);

    const service = await buildService();
    await expect(service.retryFailedDeliveries(WEBHOOK_ID, TENANT_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(listRetryableDeliveriesMock).not.toHaveBeenCalled();
  });
});
