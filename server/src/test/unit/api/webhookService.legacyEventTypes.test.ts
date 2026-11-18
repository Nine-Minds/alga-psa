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
const getById = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const countDeliveries = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('@/lib/webhooks/webhookModel', async (orig) => {
  const actual: any = await orig();
  return { ...actual, webhookModel: { ...actual.webhookModel, insert, getById, update, countDeliveries } };
});

const legacyRow = {
  webhookId: WEBHOOK,
  tenant: TENANT,
  name: 'Old',
  url: 'https://example.test/hook',
  method: 'POST',
  eventTypes: ['invoice.created', 'ticket.updated'],
  isActive: true,
  verifySsl: true,
  totalDeliveries: 0,
  successfulDeliveries: 0,
  failedDeliveries: 0,
};

async function makeService() {
  const { WebhookService } = await import('../../../lib/api/services/WebhookService');
  getById.mockResolvedValue({ ...legacyRow });
  update.mockImplementation(async (_id: string, _tenant: string, input: any) => ({
    ...legacyRow,
    ...(input.eventTypes ? { eventTypes: input.eventTypes } : {}),
    ...(input.name ? { name: input.name } : {}),
  }));
  const eventBus = { publish: vi.fn(async () => undefined) };
  const service: any = new WebhookService(eventBus as any, { log: vi.fn(async () => undefined) } as any);
  vi.spyOn(service, 'validateWebhookUrl').mockResolvedValue(undefined);
  return { service };
}

describe('WebhookService legacy event types', () => {
  beforeEach(() => {
    insert.mockReset();
    getById.mockReset();
    update.mockReset();
  });

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
    const { service } = await makeService();
    await expect(
      service.updateWebhook(WEBHOOK, { event_types: ['invoice.created', 'client.created'] }, TENANT),
    ).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('update rejects a legacy/unknown name that is NOT already stored', async () => {
    const { service } = await makeService();
    await expect(
      service.updateWebhook(WEBHOOK, { event_types: ['ticket.updated', 'asset.created'] }, TENANT),
    ).rejects.toThrow(/Unsupported event type: asset\.created/);
    expect(update).not.toHaveBeenCalled();
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
