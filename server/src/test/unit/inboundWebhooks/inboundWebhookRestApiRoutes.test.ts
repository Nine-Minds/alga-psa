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
});
