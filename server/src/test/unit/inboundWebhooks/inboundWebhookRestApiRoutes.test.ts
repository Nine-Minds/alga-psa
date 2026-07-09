import { beforeEach, describe, expect, it, vi } from 'vitest';

const inboundActions = vi.hoisted(() => ({
  listInboundWebhooks: vi.fn(),
  getInboundWebhook: vi.fn(),
  upsertInboundWebhook: vi.fn(),
  deleteInboundWebhook: vi.fn(),
  rotateInboundWebhookSecret: vi.fn(),
  sendInboundWebhookTest: vi.fn(),
  captureSamplePayload: vi.fn(),
  clearSamplePayload: vi.fn(),
  listInboundDeliveries: vi.fn(),
  getInboundDelivery: vi.fn(),
  replayInboundDelivery: vi.fn(),
  listInboundWebhookActions: vi.fn(),
}));

vi.mock('@/lib/actions/inboundWebhookActions', () => inboundActions);

vi.mock('server/src/lib/api/middleware/apiMiddleware', async () => {
  const { NextResponse } = await import('next/server');

  class NotFoundError extends Error {
    statusCode = 404;
    code = 'NOT_FOUND';
  }

  const isServerActionErrorResult = (value: unknown) => {
    const candidate = value as Record<string, unknown>;
    return (
      typeof value === 'object' &&
      value !== null &&
      (typeof candidate.permissionError === 'string' || typeof candidate.actionError === 'string')
    );
  };

  const createServerActionErrorResponse = (error: { permissionError?: string; actionError?: string }) => {
    if (error.permissionError) {
      return NextResponse.json({
        error: {
          code: 'FORBIDDEN',
          message: error.permissionError,
        },
      }, { status: 403 });
    }

    const message = error.actionError ?? 'Bad request';
    const status = message.toLowerCase().includes('not found')
      ? 404
      : message.toLowerCase().includes('already exists')
        ? 409
        : 400;

    return NextResponse.json({
      error: {
        code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'BAD_REQUEST',
        message,
      },
    }, { status });
  };

  const handleApiError = (error: any) => NextResponse.json({
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: error.message ?? 'An unexpected error occurred',
    },
  }, { status: error.statusCode ?? 500 });

  return {
    NotFoundError,
    createServerActionErrorResponse,
    handleApiError,
    isServerActionErrorResult,
  };
});

const webhookFixture = {
  inboundWebhookId: 'webhook-1',
  tenant: 'tenant-a',
  name: 'RMM Alerts',
  slug: 'rmm-alerts',
  description: 'Monitoring alerts',
  authType: 'hmac_sha256',
  authConfig: {
    type: 'hmac_sha256',
    signatureHeader: 'X-Alga-Signature',
    secretVaultPath: 'tenant/tenant-a/inbound-webhooks/webhook-1/hmac',
  },
  idempotencySource: { type: 'header', value: 'X-Idempotency-Key' },
  idempotencyWindowSeconds: 86400,
  handlerType: 'direct_action',
  handlerConfig: {
    type: 'direct_action',
    action: 'createTicket',
    fieldMapping: { title: 'alert.message' },
  },
  isActive: true,
  createdAt: '2026-05-11T10:00:00.000Z',
  updatedAt: '2026-05-11T10:00:00.000Z',
};

const deliveryFixture = {
  deliveryId: 'delivery-1',
  tenant: 'tenant-a',
  inboundWebhookId: 'webhook-1',
  idempotencyKey: 'alert-1',
  receivedAt: '2026-05-11T10:01:00.000Z',
  requestMethod: 'POST',
  requestPath: '/api/inbound/tenant-slug/rmm-alerts',
  requestHeaders: { 'content-type': 'application/json' },
  requestBody: { alert: { id: 'alert-1' } },
  authStatus: 'verified',
  dispatchStatus: 'dispatched',
  responseStatus: 200,
  responseBody: { delivery_id: 'delivery-1' },
  durationMs: 42,
  isReplay: false,
  replayedFrom: null,
};

const routeContext = (params: Record<string, string>) => ({
  params: Promise.resolve(params),
});

describe('inbound webhook REST API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns listed inbound webhooks through the tenant-scoped server action', async () => {
    inboundActions.listInboundWebhooks.mockResolvedValue([webhookFixture]);

    const route = await import('@/app/api/v1/inbound-webhooks/route');
    const response = await route.GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [webhookFixture] });
    expect(inboundActions.listInboundWebhooks).toHaveBeenCalledTimes(1);
    expect(inboundActions.listInboundWebhooks).toHaveBeenCalledWith();
  });

  it('creates an inbound webhook and returns its one-time secret', async () => {
    const input = {
      name: 'RMM Alerts',
      slug: 'rmm-alerts',
      auth_type: 'hmac_sha256',
      auth_config: {
        type: 'hmac_sha256',
        signature_header: 'X-Alga-Signature',
        secret: 'caller-provided-secret',
      },
      handler_type: 'direct_action',
      handler_config: {
        type: 'direct_action',
        action: 'createTicket',
        field_mapping: { title: 'alert.message' },
      },
    };
    inboundActions.upsertInboundWebhook.mockResolvedValue({
      webhook: webhookFixture,
      secret: 'generated-secret',
    });

    const route = await import('@/app/api/v1/inbound-webhooks/route');
    const response = await route.POST(
      new Request('http://localhost/api/v1/inbound-webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: webhookFixture,
      secret: 'generated-secret',
    });
    expect(inboundActions.upsertInboundWebhook).toHaveBeenCalledWith(input);
  });

  it('returns one inbound webhook without raw secret material', async () => {
    const redactedWebhook = {
      ...webhookFixture,
      authConfig: {
        type: 'hmac_sha256',
        signatureHeader: 'X-Alga-Signature',
        secretVaultPath: 'tenant/tenant-a/inbound-webhooks/webhook-1/hmac',
      },
    };
    inboundActions.getInboundWebhook.mockResolvedValue(redactedWebhook);

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/route');
    const response = await route.GET(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1'),
      routeContext({ id: 'webhook-1' }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: redactedWebhook });
    expect(JSON.stringify(body)).not.toContain('raw-secret');
    expect(JSON.stringify(body)).not.toContain('caller-provided-secret');
    expect(inboundActions.getInboundWebhook).toHaveBeenCalledWith('webhook-1');
  });

  it('updates an inbound webhook using the path id as the persisted id', async () => {
    const input = {
      inbound_webhook_id: 'body-id-ignored',
      name: 'Updated RMM Alerts',
      slug: 'rmm-alerts',
      description: 'Updated description',
    };
    const updatedWebhook = {
      ...webhookFixture,
      name: 'Updated RMM Alerts',
      description: 'Updated description',
      updatedAt: '2026-05-11T11:00:00.000Z',
    };
    inboundActions.upsertInboundWebhook.mockResolvedValue({
      webhook: updatedWebhook,
      secret: null,
    });

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/route');
    const response = await route.PUT(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      routeContext({ id: 'webhook-1' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: updatedWebhook,
      secret: null,
    });
    expect(inboundActions.upsertInboundWebhook).toHaveBeenCalledWith({
      ...input,
      inbound_webhook_id: 'webhook-1',
    });
  });

  it('deletes an inbound webhook and returns an empty 204 response', async () => {
    inboundActions.deleteInboundWebhook.mockResolvedValue(undefined);

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/route');
    const response = await route.DELETE(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1', { method: 'DELETE' }),
      routeContext({ id: 'webhook-1' }),
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
    expect(inboundActions.deleteInboundWebhook).toHaveBeenCalledWith('webhook-1');
  });

  it('rotates an inbound webhook secret and returns the replacement once', async () => {
    inboundActions.rotateInboundWebhookSecret.mockResolvedValue({
      webhook: webhookFixture,
      secret: 'replacement-secret',
    });

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/rotate-secret/route');
    const response = await route.POST(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1/rotate-secret', { method: 'POST' }),
      routeContext({ id: 'webhook-1' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: webhookFixture,
      secret: 'replacement-secret',
    });
    expect(inboundActions.rotateInboundWebhookSecret).toHaveBeenCalledWith('webhook-1');
  });

  it('dispatches a synthetic inbound webhook request in process', async () => {
    const input = {
      body: { alert: { id: 'alert-1', message: 'CPU high' } },
      headers: { 'x-idempotency-key': 'alert-1' },
    };
    inboundActions.sendInboundWebhookTest.mockResolvedValue(deliveryFixture);

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/test/route');
    const response = await route.POST(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      routeContext({ id: 'webhook-1' }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: deliveryFixture });
    expect(inboundActions.sendInboundWebhookTest).toHaveBeenCalledWith('webhook-1', input);
  });

  it('enables sample capture for an inbound webhook', async () => {
    inboundActions.captureSamplePayload.mockResolvedValue({
      ...webhookFixture,
      sampleCaptureExpiresAt: '2026-05-11T10:05:00.000Z',
    });

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/capture-sample/route');
    const response = await route.POST(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1/capture-sample', { method: 'POST' }),
      routeContext({ id: 'webhook-1' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        ...webhookFixture,
        sampleCaptureExpiresAt: '2026-05-11T10:05:00.000Z',
      },
    });
    expect(inboundActions.captureSamplePayload).toHaveBeenCalledWith('webhook-1');
  });

  it('clears a captured sample payload for an inbound webhook', async () => {
    inboundActions.clearSamplePayload.mockResolvedValue({
      ...webhookFixture,
      samplePayload: null,
      sampleCaptureExpiresAt: null,
    });

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/capture-sample/route');
    const response = await route.DELETE(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1/capture-sample', { method: 'DELETE' }),
      routeContext({ id: 'webhook-1' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        ...webhookFixture,
        samplePayload: null,
        sampleCaptureExpiresAt: null,
      },
    });
    expect(inboundActions.clearSamplePayload).toHaveBeenCalledWith('webhook-1');
  });

  it('lists inbound deliveries with pagination and filters forced to the path webhook', async () => {
    inboundActions.listInboundDeliveries.mockResolvedValue({
      data: [deliveryFixture],
      page: 2,
      limit: 10,
      total: 42,
    });

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/deliveries/route');
    const response = await route.GET(
      new Request(
        'http://localhost/api/v1/inbound-webhooks/webhook-1/deliveries?page=2&limit=10&status=failed&date_from=2026-05-01&date_to=2026-05-11',
      ),
      routeContext({ id: 'webhook-1' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [deliveryFixture],
      meta: { page: 2, limit: 10, total: 42 },
    });
    expect(inboundActions.listInboundDeliveries).toHaveBeenCalledWith(
      {
        inboundWebhookId: 'webhook-1',
        status: 'failed',
        dateFrom: '2026-05-01',
        dateTo: '2026-05-11',
      },
      2,
      10,
    );
  });

  it('returns one inbound delivery when it belongs to the path webhook', async () => {
    inboundActions.getInboundDelivery.mockResolvedValue(deliveryFixture);

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/route');
    const response = await route.GET(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1/deliveries/delivery-1'),
      routeContext({ id: 'webhook-1', deliveryId: 'delivery-1' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: deliveryFixture });
    expect(inboundActions.getInboundDelivery).toHaveBeenCalledWith('delivery-1');
  });

  it('replays one inbound delivery and returns the linked replay row', async () => {
    const replayedDelivery = {
      ...deliveryFixture,
      deliveryId: 'delivery-2',
      isReplay: true,
      replayedFrom: 'delivery-1',
    };
    inboundActions.getInboundDelivery.mockResolvedValue(deliveryFixture);
    inboundActions.replayInboundDelivery.mockResolvedValue(replayedDelivery);

    const route = await import('@/app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/replay/route');
    const response = await route.POST(
      new Request('http://localhost/api/v1/inbound-webhooks/webhook-1/deliveries/delivery-1/replay', {
        method: 'POST',
      }),
      routeContext({ id: 'webhook-1', deliveryId: 'delivery-1' }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: replayedDelivery });
    expect(inboundActions.getInboundDelivery).toHaveBeenCalledWith('delivery-1');
    expect(inboundActions.replayInboundDelivery).toHaveBeenCalledWith('delivery-1');
  });

  it('returns registered inbound action definitions with target field schemas', async () => {
    const actionDefinitions = [
      {
        name: 'createTicket',
        entityType: 'ticket',
        displayName: 'Create Ticket',
        description: 'Create a ticket from mapped webhook fields',
        targetFields: [
          {
            name: 'title',
            type: 'string',
            required: true,
            description: 'Ticket title',
          },
        ],
      },
    ];
    inboundActions.listInboundWebhookActions.mockResolvedValue(actionDefinitions);

    const route = await import('@/app/api/v1/inbound-webhooks/actions/route');
    const response = await route.GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: actionDefinitions });
    expect(inboundActions.listInboundWebhookActions).toHaveBeenCalledTimes(1);
  });

  it('does not transform action discovery output away from the registry-backed server action', async () => {
    const actionDefinitions = [
      {
        name: 'upsertClientByExternalId',
        entityType: 'client',
        displayName: 'Upsert Client',
        description: 'Create or update a client by external id',
        targetFields: [
          {
            name: 'external_id',
            type: 'string',
            required: true,
            description: 'External client id',
          },
        ],
      },
    ];
    inboundActions.listInboundWebhookActions.mockResolvedValue(actionDefinitions);

    const route = await import('@/app/api/v1/inbound-webhooks/actions/route');
    const response = await route.GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: actionDefinitions });
  });

  it('returns server-action authorization failures without adding a parallel auth path', async () => {
    inboundActions.listInboundWebhooks.mockResolvedValue({
      permissionError: 'Permission denied: inbound_webhook:read permission required',
    });

    const route = await import('@/app/api/v1/inbound-webhooks/route');
    const response = await route.GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Permission denied: inbound_webhook:read permission required',
      },
    });
  });
});
