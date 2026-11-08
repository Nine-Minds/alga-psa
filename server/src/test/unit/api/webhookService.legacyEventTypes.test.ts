import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const WEBHOOK = '22222222-2222-4222-8222-222222222222';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const insert = vi.hoisted(() => vi.fn());
vi.mock('@/lib/webhooks/webhookModel', async (orig) => {
  const actual: any = await orig();
  return { ...actual, webhookModel: { ...actual.webhookModel, insert } };
});

const legacyRow = {
  webhook_id: WEBHOOK,
  tenant: TENANT,
  name: 'Old',
  url: 'https://example.test/hook',
  method: 'POST',
  event_types: ['invoice.created', 'ticket.updated'],
  is_active: true,
  verify_ssl: true,
  total_deliveries: 0,
  successful_deliveries: 0,
  failed_deliveries: 0,
};

async function makeService() {
  const { WebhookService } = await import('../../../lib/api/services/WebhookService');
  const db = {
    findOne: vi.fn(async () => ({ ...legacyRow })),
    update: vi.fn(async () => undefined),
    count: vi.fn(async () => 0),
    delete: vi.fn(async () => undefined),
    insert: vi.fn(async () => undefined),
    findMany: vi.fn(async () => []),
  };
  const eventBus = { publish: vi.fn(async () => undefined) };
  const service: any = new WebhookService(db as any, eventBus as any, { log: vi.fn(async () => undefined) } as any);
  vi.spyOn(service, 'validateWebhookUrl').mockResolvedValue(undefined);
  vi.spyOn(service, 'updateEventSubscriptions').mockResolvedValue(undefined);
  return { service, db };
}

describe('WebhookService legacy event types', () => {
  beforeEach(() => insert.mockReset());

  it('create rejects an unknown/legacy event type with a validation error', async () => {
    const { service } = await makeService();
    await expect(
      service.createWebhook(
        { name: 'n', url: 'https://example.test/h', method: 'POST', event_types: ['invoice.created'] },
        TENANT,
        'user-1',
      ),
    ).rejects.toThrow(/Unsupported event type: invoice\.created/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('update lets legacy names that are already stored pass through', async () => {
    const { service, db } = await makeService();
    await expect(
      service.updateWebhook(WEBHOOK, { event_types: ['invoice.created', 'client.created'] }, TENANT),
    ).resolves.toBeDefined();
    expect(db.update).toHaveBeenCalled();
  });

  it('update rejects a legacy/unknown name that is NOT already stored', async () => {
    const { service, db } = await makeService();
    await expect(
      service.updateWebhook(WEBHOOK, { event_types: ['ticket.updated', 'asset.created'] }, TENANT),
    ).rejects.toThrow(/Unsupported event type: asset\.created/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('update without event_types never validates event names (other fields still editable)', async () => {
    const { service } = await makeService();
    await expect(service.updateWebhook(WEBHOOK, { name: 'Renamed' }, TENANT)).resolves.toBeDefined();
  });

  it('getWebhook returns a row holding legacy names without error', async () => {
    const { service } = await makeService();
    const res = await service.getWebhook(WEBHOOK, TENANT);
    expect(res.data.event_types).toEqual(['invoice.created', 'ticket.updated']);
  });
});
