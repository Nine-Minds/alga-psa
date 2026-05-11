import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
  getOrCreateWithStatus: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@/lib/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
}));

vi.mock('@alga-psa/tags/models/tagDefinition', () => ({
  default: {
    getOrCreateWithStatus: mocks.getOrCreateWithStatus,
  },
}));

async function loadTagInboundActions() {
  vi.resetModules();
  await import('@alga-psa/tags/actions/inboundActions');
  return import('@/lib/inboundWebhooks/actions/registry');
}

function createQuery(firstValue: unknown, returningValue: unknown[] = []) {
  return {
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstValue),
    insert: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningValue),
  };
}

describe('tag inbound webhook actions', () => {
  const tenantKnex = { name: 'tenant-knex' };
  let trx: ReturnType<typeof vi.fn> & { fn: { now: ReturnType<typeof vi.fn> } };
  let ticketQuery: ReturnType<typeof createQuery>;
  let tagMappingsQuery: ReturnType<typeof createQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    ticketQuery = createQuery({ ticket_id: 'ticket-1' });
    tagMappingsQuery = createQuery(null, [{ mapping_id: 'mapping-1' }]);
    trx = Object.assign(
      vi.fn((table: string) => {
        if (table === 'tickets') {
          return ticketQuery;
        }
        if (table === 'tag_mappings') {
          return tagMappingsQuery;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      {
        fn: {
          now: vi.fn(() => 'db-now'),
        },
      },
    );
    mocks.createTenantKnex.mockResolvedValue({ knex: tenantKnex });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (transaction: unknown) => unknown) =>
      callback(trx),
    );
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'ticket-1',
      externalEntityId: 'alert-42',
      metadata: {},
    });
    mocks.getOrCreateWithStatus.mockResolvedValue({
      definition: {
        tag_id: 'tag-1',
        tag_text: 'critical',
        tagged_type: 'ticket',
      },
      created: true,
    });
  });

  it('T1080: addTagToEntityByExternalId attaches a tag to a mapped ticket', async () => {
    const { getAction } = await loadTagInboundActions();
    const action = getAction('addTagToEntityByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { alert: { id: 'alert-42' } },
          idempotencyKey: 'alert-42',
        },
        {
          entity_type: 'ticket',
          external_id: 'alert-42',
          tag_text: ' critical ',
          background_color: '#ff0000',
          text_color: '#ffffff',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'ticket',
      entityId: 'ticket-1',
      externalId: 'alert-42',
      metadata: {
        tag_id: 'tag-1',
        tag_mapping_id: 'mapping-1',
        tag_text: 'critical',
        created: true,
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'alerts',
      'ticket',
      'alert-42',
      { knex: trx },
    );
    expect(ticketQuery.where).toHaveBeenCalledWith({ tenant: 'tenant-a', ticket_id: 'ticket-1' });
    expect(mocks.getOrCreateWithStatus).toHaveBeenCalledWith(trx, 'tenant-a', 'critical', 'ticket', {
      background_color: '#ff0000',
      text_color: '#ffffff',
    });
    expect(tagMappingsQuery.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      tag_id: 'tag-1',
      tagged_id: 'ticket-1',
      tagged_type: 'ticket',
    });
    expect(tagMappingsQuery.insert).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      tag_id: 'tag-1',
      tagged_id: 'ticket-1',
      tagged_type: 'ticket',
      created_by: null,
      created_at: 'db-now',
    });
  });
});
