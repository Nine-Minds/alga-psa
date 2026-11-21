import { describe, expect, it, vi } from 'vitest';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WEBHOOK_ID = '22222222-2222-4222-8222-222222222222';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const model = vi.hoisted(() => ({
  getById: vi.fn(),
  countDeliveries: vi.fn(async () => 0),
}));
vi.mock('@/lib/webhooks/webhookModel', async (orig) => {
  const actual: any = await orig();
  return { ...actual, webhookModel: { ...actual.webhookModel, ...model } };
});

const webhookRow = {
  webhookId: WEBHOOK_ID,
  tenant: TENANT_ID,
  name: 'Ticket updates',
  url: 'https://example.test/hook',
  method: 'POST',
  eventTypes: ['ticket.updated'],
  isActive: true,
  verifySsl: true,
  totalDeliveries: 0,
  successfulDeliveries: 0,
  failedDeliveries: 0,
};

describe('WebhookService.getWebhook HATEOAS links', () => {
  it('advertises only actions backed by real routes, including the bulk retry', async () => {
    const { WebhookService } = await import('../../../lib/api/services/WebhookService');
    model.getById.mockResolvedValue({ ...webhookRow });
    const service = new WebhookService();

    const result = await service.getWebhook(WEBHOOK_ID, TENANT_ID);
    const links = (result.data as any)._links as Record<string, { href: string; method: string }>;

    expect(links.test).toEqual({
      href: `/api/v1/webhooks/${WEBHOOK_ID}/test`,
      method: 'POST',
      rel: 'action',
    });
    expect(links.deliveries).toEqual({
      href: `/api/v1/webhooks/${WEBHOOK_ID}/deliveries`,
      method: 'GET',
      rel: 'action',
    });
    expect(links.analytics).toEqual({
      href: `/api/v1/webhooks/${WEBHOOK_ID}/analytics`,
      method: 'GET',
      rel: 'action',
    });

    expect(links['retry-failed']).toEqual({
      href: `/api/v1/webhooks/${WEBHOOK_ID}/retry-failed`,
      method: 'POST',
      rel: 'action',
    });

    // The phantom webhook-level `retry` link removed in #3719 stays gone: the
    // bulk capability lives at retry-failed, and /webhooks/{id}/retry has no route.
    expect(links).not.toHaveProperty('retry');
    expect(
      Object.values(links).filter((link) => link.href.endsWith(`/webhooks/${WEBHOOK_ID}/retry`))
    ).toEqual([]);
  });
});
