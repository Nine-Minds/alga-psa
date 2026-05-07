import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const webhookModelState = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  getDeliveryByIdMock: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
  runWithTenantMock: vi.fn(async (_t: string, cb: () => Promise<unknown>) => cb()),
}));

vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    getById: (...args: unknown[]) => webhookModelState.getByIdMock(...args),
    getDeliveryById: (...args: unknown[]) => webhookModelState.getDeliveryByIdMock(...args),
  },
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: (...args: unknown[]) => dbState.runWithTenantMock(...args),
}));

import { ApiWebhookController } from '@/lib/api/controllers/ApiWebhookController';
import { webhookEventTypeSchema } from '@/lib/api/schemas/webhookSchemas';

const TENANT = 'tenant-a';

function makeRequest(url: string) {
  return new NextRequest(url, { headers: { 'x-api-key': 'irrelevant' } }) as any;
}

function makeAuthenticatedReq(req: any) {
  req.context = { tenant: TENANT, userId: 'user-1' };
  return req;
}

describe('webhook controller endpoints (T036)', () => {
  const proto: any = ApiWebhookController.prototype;
  const originalAuthenticate = proto.authenticate;
  const originalCheckPermission = proto.checkPermission;

  beforeEach(() => {
    webhookModelState.getByIdMock.mockReset();
    webhookModelState.getDeliveryByIdMock.mockReset();
    dbState.runWithTenantMock.mockClear();

    proto.authenticate = async (req: any) => makeAuthenticatedReq(req);
    proto.checkPermission = async () => undefined;
  });

  afterEach(() => {
    proto.authenticate = originalAuthenticate;
    proto.checkPermission = originalCheckPermission;
  });

  it('getDelivery returns the row when webhookModel.getDeliveryById finds one', async () => {
    const delivery = {
      deliveryId: 'd-1',
      tenant: TENANT,
      webhookId: '11111111-1111-1111-1111-111111111111',
      eventId: 'event-1',
      eventType: 'ticket.assigned',
      status: 'delivered',
      attemptNumber: 1,
    };
    webhookModelState.getDeliveryByIdMock.mockResolvedValue(delivery);

    const controller = new ApiWebhookController();
    const handler = controller.getDelivery();
    const req = makeRequest('http://localhost/api/v1/webhooks/11111111-1111-1111-1111-111111111111/deliveries/d-1');
    const response = await handler(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(delivery);
  });

  it('getHealth derives status/success_rate from webhook stats columns', async () => {
    webhookModelState.getByIdMock.mockResolvedValue({
      tenant: TENANT,
      webhookId: '11111111-1111-1111-1111-111111111111',
      isActive: true,
      autoDisabledAt: null,
      totalDeliveries: 10,
      successfulDeliveries: 7,
      failedDeliveries: 3,
      lastDeliveryAt: new Date('2026-05-06T15:00:00Z'),
      lastSuccessAt: new Date('2026-05-06T15:00:00Z'),
      lastFailureAt: new Date('2026-05-06T14:00:00Z'),
    });

    const controller = new ApiWebhookController();
    const handler = controller.getHealth();
    const req = makeRequest('http://localhost/api/v1/webhooks/11111111-1111-1111-1111-111111111111/health');
    const response = await handler(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      webhook_id: '11111111-1111-1111-1111-111111111111',
      status: 'healthy',
      total_deliveries: 10,
      successful_deliveries: 7,
      failed_deliveries: 3,
      success_rate: 0.7,
    });
  });

  it('getSubscriptions echoes the webhook.event_types array', async () => {
    webhookModelState.getByIdMock.mockResolvedValue({
      webhookId: '11111111-1111-1111-1111-111111111111',
      eventTypes: ['ticket.created', 'ticket.assigned'],
    });

    const controller = new ApiWebhookController();
    const handler = controller.getSubscriptions();
    const req = makeRequest('http://localhost/api/v1/webhooks/11111111-1111-1111-1111-111111111111/subscriptions');
    const response = await handler(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      webhook_id: '11111111-1111-1111-1111-111111111111',
      event_types: ['ticket.created', 'ticket.assigned'],
    });
  });

  it('listEvents returns the public webhookEventTypeSchema enum verbatim', async () => {
    const controller = new ApiWebhookController();
    const handler = controller.listEvents();
    const req = makeRequest('http://localhost/api/v1/webhooks/events');
    const response = await handler(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([...webhookEventTypeSchema.options]);
  });

  it('deferred routes are unregistered (their files no longer exist on disk)', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const deletedRoutes = [
      'server/src/app/api/v1/webhooks/transform/test/route.ts',
      'server/src/app/api/v1/webhooks/[id]/transform/test/route.ts',
      'server/src/app/api/v1/webhooks/filter/test/route.ts',
      'server/src/app/api/v1/webhooks/[id]/filter/test/route.ts',
      'server/src/app/api/v1/webhooks/validate/route.ts',
      'server/src/app/api/v1/webhooks/[id]/validate/route.ts',
      'server/src/app/api/v1/webhooks/bulk/route.ts',
      'server/src/app/api/v1/webhooks/search/route.ts',
      'server/src/app/api/v1/webhooks/export/route.ts',
      'server/src/app/api/v1/webhooks/events/trigger/route.ts',
      'server/src/app/api/v1/webhooks/health/route.ts',
      'server/src/app/api/v1/webhooks/subscriptions/route.ts',
    ];

    for (const relPath of deletedRoutes) {
      const fullPath = path.join(repoRoot, relPath);
      expect(fs.existsSync(fullPath)).toBe(false);
    }
  });
});
