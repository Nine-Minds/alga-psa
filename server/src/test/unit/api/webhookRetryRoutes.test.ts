import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WEBHOOK_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const getByIdMock = vi.hoisted(() => vi.fn());
const getDeliveryByIdMock = vi.hoisted(() => vi.fn());
const listRetryableDeliveriesMock = vi.hoisted(() => vi.fn());
const enqueueMock = vi.hoisted(() => vi.fn(async () => undefined));
const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({
      tenant: TENANT_ID,
      user_id: 'user-1',
      api_key_id: 'key-1',
    })),
    validateApiKeyForTenant: vi.fn(async () => ({
      tenant: TENANT_ID,
      user_id: 'user-1',
      api_key_id: 'key-1',
    })),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({
    user_id: 'user-1',
    user_type: 'internal',
    tenant: TENANT_ID,
  })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
  tenantDb: vi.fn(() => ({ table: () => ({}) })),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class ProductAccessError extends Error {},
}));

vi.mock('@/lib/productSurfaceRegistry', () => ({
  resolveProductApiBehavior: vi.fn(() => 'allowed'),
}));

vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    getById: getByIdMock,
    getDeliveryById: getDeliveryByIdMock,
    listRetryableDeliveries: listRetryableDeliveriesMock,
  },
}));

vi.mock('@/lib/webhooks/WebhookDeliveryQueue', () => ({
  WebhookDeliveryQueue: {
    getInstance: () => ({ enqueue: enqueueMock }),
  },
}));

import { POST as retryFailedPOST } from '@/app/api/v1/webhooks/[id]/retry-failed/route';
import { POST as retryDeliveryPOST } from '@/app/api/v1/webhooks/[id]/deliveries/[delivery_id]/retry/route';

function buildDelivery(overrides: Record<string, unknown> = {}) {
  return {
    tenant: TENANT_ID,
    deliveryId: DELIVERY_ID,
    webhookId: WEBHOOK_ID,
    eventId: EVENT_ID,
    eventType: 'ticket.updated',
    requestHeaders: null,
    requestBody: {
      event_id: EVENT_ID,
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
    durationMs: 10,
    errorMessage: 'boom',
    nextRetryAt: null,
    isTest: false,
    attemptedAt: new Date('2026-10-01T00:00:00.000Z'),
    completedAt: null,
    ...overrides,
  } as any;
}

function retryFailedRequest(body?: unknown) {
  return new NextRequest(`http://localhost/api/v1/webhooks/${WEBHOOK_ID}/retry-failed`, {
    method: 'POST',
    headers: { 'x-api-key': 'test-api-key', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as Request;
}

function retryDeliveryRequest() {
  return new NextRequest(
    `http://localhost/api/v1/webhooks/${WEBHOOK_ID}/deliveries/${DELIVERY_ID}/retry`,
    {
      method: 'POST',
      headers: { 'x-api-key': 'test-api-key', 'content-type': 'application/json' },
    },
  ) as unknown as Request;
}

describe('POST /api/v1/webhooks/{id}/retry-failed', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    getByIdMock.mockReset();
    getByIdMock.mockResolvedValue({ webhookId: WEBHOOK_ID, tenant: TENANT_ID });
    getDeliveryByIdMock.mockReset();
    listRetryableDeliveriesMock.mockReset();
    listRetryableDeliveriesMock.mockResolvedValue({ data: [], totalCandidates: 0 });
    enqueueMock.mockClear();
    fetchSpy.mockClear();
  });

  it('returns a single-wrapped 202 body with the retry counts', async () => {
    listRetryableDeliveriesMock.mockResolvedValue({
      data: [buildDelivery(), buildDelivery({ requestBody: { nope: true } })],
      totalCandidates: 2,
    });

    const response = await retryFailedPOST(retryFailedRequest());

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({
      data: { queued: 1, skipped: 1, total_candidates: 2, truncated: false },
    });
    expect(body.data.data).toBeUndefined();
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('checks the webhook retry permission before doing any work', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const response = await retryFailedPOST(retryFailedRequest());

    expect(response.status).toBe(403);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'webhook',
      'retry',
      expect.anything(),
    );
    expect(listRetryableDeliveriesMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('accepts an empty body and forwards since/limit when supplied', async () => {
    await retryFailedPOST(retryFailedRequest());
    expect(listRetryableDeliveriesMock).toHaveBeenLastCalledWith(TENANT_ID, WEBHOOK_ID, {
      since: undefined,
      limit: 500,
    });

    await retryFailedPOST(retryFailedRequest({ since: '2026-09-30T12:00:00.000Z', limit: 10 }));
    expect(listRetryableDeliveriesMock).toHaveBeenLastCalledWith(TENANT_ID, WEBHOOK_ID, {
      since: new Date('2026-09-30T12:00:00.000Z'),
      limit: 10,
    });
  });

  it('rejects a limit above the hard maximum', async () => {
    const response = await retryFailedPOST(retryFailedRequest({ limit: 5000 }));

    expect(response.status).toBe(400);
    expect(listRetryableDeliveriesMock).not.toHaveBeenCalled();
  });

  it('404s when the webhook is not in the tenant', async () => {
    getByIdMock.mockResolvedValue(null);

    const response = await retryFailedPOST(retryFailedRequest());

    expect(response.status).toBe(404);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/webhooks/{id}/deliveries/{delivery_id}/retry', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    getDeliveryByIdMock.mockReset();
    enqueueMock.mockClear();
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('enqueues a fresh attempt instead of delivering in-band', async () => {
    getDeliveryByIdMock.mockResolvedValue(buildDelivery());

    const response = await retryDeliveryPOST(retryDeliveryRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      data: {
        queued: true,
        webhook_id: WEBHOOK_ID,
        delivery_id: DELIVERY_ID,
        event_id: EVENT_ID,
      },
    });
    expect(getDeliveryByIdMock).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID, DELIVERY_ID);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0]![0]).toMatchObject({ attempt: 1, tenantId: TENANT_ID });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('409s a delivery that already succeeded', async () => {
    getDeliveryByIdMock.mockResolvedValue(buildDelivery({ status: 'delivered' }));

    const response = await retryDeliveryPOST(retryDeliveryRequest());

    expect(response.status).toBe(409);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('refuses test deliveries', async () => {
    getDeliveryByIdMock.mockResolvedValue(buildDelivery({ isTest: true }));

    const response = await retryDeliveryPOST(retryDeliveryRequest());

    expect(response.status).toBe(400);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('422s when the stored envelope is no longer replayable', async () => {
    getDeliveryByIdMock.mockResolvedValue(buildDelivery({ requestBody: { legacy: 'shape' } }));

    const response = await retryDeliveryPOST(retryDeliveryRequest());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('404s an unknown delivery', async () => {
    getDeliveryByIdMock.mockResolvedValue(null);

    const response = await retryDeliveryPOST(retryDeliveryRequest());

    expect(response.status).toBe(404);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
