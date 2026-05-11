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
});
