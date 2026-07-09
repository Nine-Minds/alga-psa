import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
  getOrCreateWithStatus: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (tableExpr: string) => {
      const builder = conn(tableExpr);
      if (!builder || typeof builder.where !== 'function') {
        return builder;
      }
      const aliasMatch = /\bas\s+([A-Za-z0-9_]+)\s*$/i.exec(tableExpr.trim());
      const tenantColumn = aliasMatch ? `${aliasMatch[1]}.tenant` : 'tenant';
      builder.where({ [tenantColumn]: tenant });
      return {
        ...builder,
        where: (criteria: any, ...rest: any[]) =>
          criteria && typeof criteria === 'object' && !Array.isArray(criteria)
            ? builder.where({ [tenantColumn]: tenant, ...criteria })
            : builder.where(criteria, ...rest),
      };
    },
    scoped: (t: string) => conn(t),
    subquery: (t: string) => conn(t),
    parentScopedTable: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
    tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
    tenantWhereColumn: (q: any) => q,
  }),
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@alga-psa/shared/inboundWebhooks/externalEntityMappings', () => ({
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
  return import('@alga-psa/shared/inboundWebhooks/actions/registry');
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
  let clientQuery: ReturnType<typeof createQuery>;
  let tagMappingsQuery: ReturnType<typeof createQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    ticketQuery = createQuery({ ticket_id: 'ticket-1' });
    clientQuery = createQuery({ client_id: 'client-1' });
    tagMappingsQuery = createQuery(null, [{ mapping_id: 'mapping-1' }]);
    trx = Object.assign(
      vi.fn((table: string) => {
        if (table === 'tickets') {
          return ticketQuery;
        }
        if (table === 'clients') {
          return clientQuery;
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

  it('T1081: addTagToEntityByExternalId attaches a tag to a mapped client', async () => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'client-1',
      externalEntityId: 'customer-42',
      metadata: {},
    });
    mocks.getOrCreateWithStatus.mockResolvedValue({
      definition: {
        tag_id: 'tag-2',
        tag_text: 'vip',
        tagged_type: 'client',
      },
      created: true,
    });
    tagMappingsQuery.returning.mockResolvedValueOnce([{ mapping_id: 'mapping-2' }]);
    const { getAction } = await loadTagInboundActions();
    const action = getAction('addTagToEntityByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'crm-feed',
          deliveryId: 'delivery-2',
          headers: {},
          rawBody: { account: { id: 'customer-42' } },
          idempotencyKey: 'customer-42',
        },
        {
          entity_type: 'client',
          external_id: 'customer-42',
          tag_text: 'vip',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'client',
      entityId: 'client-1',
      externalId: 'customer-42',
      metadata: {
        tag_id: 'tag-2',
        tag_mapping_id: 'mapping-2',
        tag_text: 'vip',
        created: true,
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'crm-feed',
      'client',
      'customer-42',
      { knex: trx },
    );
    expect(clientQuery.where).toHaveBeenCalledWith({ tenant: 'tenant-a', client_id: 'client-1' });
    expect(mocks.getOrCreateWithStatus).toHaveBeenCalledWith(trx, 'tenant-a', 'vip', 'client', {
      background_color: null,
      text_color: null,
    });
    expect(tagMappingsQuery.insert).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      tag_id: 'tag-2',
      tagged_id: 'client-1',
      tagged_type: 'client',
      created_by: null,
      created_at: 'db-now',
    });
  });

  it('T1082: addTagToEntityByExternalId rejects unsupported entity types with a clear error', async () => {
    const { getAction } = await loadTagInboundActions();
    const action = getAction('addTagToEntityByExternalId');

    await expect(action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'asset-feed',
          deliveryId: 'delivery-3',
          headers: {},
          rawBody: { asset: { id: 'asset-42' } },
          idempotencyKey: 'asset-42',
        },
        {
          entity_type: 'asset',
          external_id: 'asset-42',
          tag_text: 'monitored',
        },
      )
    ).resolves.toEqual({
      success: false,
      entityType: 'tag',
      externalId: 'asset-42',
      message: 'VALIDATION_ERROR: unsupported tag entity_type "asset"',
      metadata: {
        code: 'VALIDATION_ERROR',
        field: 'entity_type',
      },
    });

    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.lookupAlgaEntityByExternalId).not.toHaveBeenCalled();
  });
});
