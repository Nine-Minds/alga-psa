import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
  writeEntityMapping: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  ensureDefaultContractForClientIfBillingConfigured: vi.fn().mockResolvedValue(undefined),
  createDefaultTaxSettingsAsync: vi.fn().mockResolvedValue(undefined),
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
  writeEntityMapping: mocks.writeEntityMapping,
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: mocks.createContact,
    updateContact: mocks.updateContact,
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildClientCreatedPayload: (params: Record<string, unknown>) => ({ ...params, eventType: 'CLIENT_CREATED' }),
  buildClientStatusChangedPayload: (params: Record<string, unknown>) => ({
    ...params,
    eventType: 'CLIENT_STATUS_CHANGED',
  }),
}));

vi.mock('@alga-psa/shared/billingClients/defaultContract', () => ({
  ensureDefaultContractForClientIfBillingConfigured: mocks.ensureDefaultContractForClientIfBillingConfigured,
}));

vi.mock('@alga-psa/clients/lib/billingHelpers', () => ({
  createDefaultTaxSettingsAsync: mocks.createDefaultTaxSettingsAsync,
}));

async function loadClientInboundActions() {
  vi.resetModules();
  await import('@alga-psa/clients/actions/inboundActions');
  return import('@alga-psa/shared/inboundWebhooks/actions/registry');
}

describe('client inbound webhook actions', () => {
  let trx: ReturnType<typeof vi.fn>;
  let clientsQuery: {
    where: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clientsQuery = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([
        {
          client_id: 'client-1',
          client_name: 'Acme Corp',
        },
      ]),
    };
    trx = vi.fn((table: string) => {
      if (table === 'clients') {
        return clientsQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createTenantKnex.mockResolvedValue({ knex: 'tenant-knex' });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (transaction: unknown) => unknown) =>
      callback(trx),
    );
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue(null);
    mocks.createContact.mockResolvedValue({
      contact_name_id: 'contact-1',
      email: 'jane@example.com',
      client_id: 'client-1',
    });
    mocks.updateContact.mockResolvedValue({
      contact_name_id: 'contact-1',
      email: 'jane.updated@example.com',
      client_id: 'client-1',
    });
  });

  it('T1020: upsertClientByExternalId creates a client when mapping is absent and writes a mapping row', async () => {
    const { getAction } = await loadClientInboundActions();
    const action = getAction('upsertClientByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { company: { id: 'company-42', name: 'Acme Corp' } },
          idempotencyKey: 'company-42',
        },
        {
          external_id: 'company-42',
          client_name: 'Acme Corp',
          client_type: 'company',
          email: 'ops@example.com',
          phone_no: '+15551234567',
          properties: { source_system: 'rmm' },
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'client',
      entityId: 'client-1',
      externalId: 'company-42',
      metadata: {
        client_name: 'Acme Corp',
        created: true,
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'client',
      'company-42',
      { knex: trx },
    );
    expect(clientsQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-a',
        client_name: 'Acme Corp',
        client_type: 'company',
        email: 'ops@example.com',
        phone_no: '+15551234567',
        is_inactive: false,
        properties: {
          source_system: 'rmm',
          inbound_webhook_external_id: 'company-42',
        },
      }),
    );
    expect(mocks.ensureDefaultContractForClientIfBillingConfigured).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({ tenant: 'tenant-a', clientId: 'client-1' }),
    );
    expect(mocks.createDefaultTaxSettingsAsync).toHaveBeenCalledWith('client-1');
    expect(mocks.publishWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CLIENT_CREATED' }),
    );
    expect(mocks.writeEntityMapping).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'client',
      'client-1',
      'company-42',
      {
        knex: trx,
        metadata: {
          source: 'inbound_webhook',
          delivery_id: 'delivery-1',
        },
      },
    );
  });

  it('T1021: upsertClientByExternalId updates an existing mapped client', async () => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'client-1',
      externalEntityId: 'company-42',
      metadata: {},
    });
    clientsQuery.first.mockResolvedValue({
      client_id: 'client-1',
      client_name: 'Acme Old',
      properties: {
        existing: true,
      },
    });
    clientsQuery.returning.mockResolvedValue([
      {
        client_id: 'client-1',
        client_name: 'Acme Corp',
      },
    ]);
    const { getAction } = await loadClientInboundActions();
    const action = getAction('upsertClientByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { company: { id: 'company-42', name: 'Acme Corp' } },
          idempotencyKey: 'company-42',
        },
        {
          external_id: 'company-42',
          client_name: 'Acme Corp',
          email: 'new-ops@example.com',
          properties: { source_system: 'rmm' },
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'client',
      entityId: 'client-1',
      externalId: 'company-42',
      metadata: {
        client_name: 'Acme Corp',
        created: false,
      },
    });

    expect(clientsQuery.where).toHaveBeenCalledWith({ tenant: 'tenant-a', client_id: 'client-1' });
    expect(clientsQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        client_name: 'Acme Corp',
        email: 'new-ops@example.com',
        properties: {
          existing: true,
          source_system: 'rmm',
          inbound_webhook_external_id: 'company-42',
        },
      }),
    );
    expect(clientsQuery.insert).not.toHaveBeenCalled();
    expect(mocks.writeEntityMapping).not.toHaveBeenCalled();
    expect(mocks.ensureDefaultContractForClientIfBillingConfigured).not.toHaveBeenCalled();
    expect(mocks.createDefaultTaxSettingsAsync).not.toHaveBeenCalled();
  });

  it('T1022: setClientActiveByExternalId toggles active state through is_inactive', async () => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'client-1',
      externalEntityId: 'company-42',
      metadata: {},
    });
    clientsQuery.returning.mockResolvedValue([
      {
        client_id: 'client-1',
        is_inactive: true,
      },
    ]);
    const { getAction } = await loadClientInboundActions();
    const action = getAction('setClientActiveByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { company: { id: 'company-42', active: false } },
          idempotencyKey: 'company-42',
        },
        {
          external_id: 'company-42',
          active: false,
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'client',
      entityId: 'client-1',
      externalId: 'company-42',
      metadata: {
        active: false,
        status_changed: true,
      },
    });

    expect(clientsQuery.where).toHaveBeenCalledWith({ tenant: 'tenant-a', client_id: 'client-1' });
    expect(clientsQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_inactive: true,
      }),
    );
    expect(mocks.publishWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CLIENT_STATUS_CHANGED' }),
    );
  });

  it('T1030: upsertContactByExternalId creates and updates contact records', async () => {
    const { getAction } = await loadClientInboundActions();
    const action = getAction('upsertContactByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { contact: { id: 'contact-42', name: 'Jane Admin' } },
          idempotencyKey: 'contact-42',
        },
        {
          external_id: 'contact-42',
          full_name: 'Jane Admin',
          email: 'jane@example.com',
          client_id: 'client-1',
          role: 'IT Manager',
          notes: 'Primary alert contact',
          is_inactive: false,
          phone: '+15555550100',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'contact',
      entityId: 'contact-1',
      externalId: 'contact-42',
      metadata: {
        email: 'jane@example.com',
        client_id: 'client-1',
      },
    });

    expect(mocks.createContact).toHaveBeenCalledWith(
      {
        full_name: 'Jane Admin',
        email: 'jane@example.com',
        client_id: 'client-1',
        role: 'IT Manager',
        notes: 'Primary alert contact',
        is_inactive: false,
        phone_numbers: [
          {
            phone_number: '+15555550100',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
        ],
      },
      'tenant-a',
      trx,
    );
    expect(mocks.writeEntityMapping).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'contact',
      'contact-1',
      'contact-42',
      {
        knex: trx,
        metadata: {
          source: 'inbound_webhook',
          delivery_id: 'delivery-1',
        },
      },
    );

    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'contact-1',
      externalEntityId: 'contact-42',
      metadata: {},
    });

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-2',
          headers: {},
          rawBody: { contact: { id: 'contact-42', name: 'Jane Updated' } },
          idempotencyKey: 'contact-42',
        },
        {
          external_id: 'contact-42',
          full_name: 'Jane Updated',
          email: 'jane.updated@example.com',
          client_id: 'client-1',
          role: 'Operations',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'contact',
      entityId: 'contact-1',
      externalId: 'contact-42',
      metadata: {
        email: 'jane.updated@example.com',
        client_id: 'client-1',
      },
    });

    expect(mocks.updateContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        full_name: 'Jane Updated',
        email: 'jane.updated@example.com',
        client_id: 'client-1',
        role: 'Operations',
      }),
      'tenant-a',
      trx,
    );
    expect(mocks.writeEntityMapping).toHaveBeenCalledTimes(1);
  });

  it('T1031: upsertContactByExternalId requires a direct or resolvable client linkage when creating', async () => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue(null);
    const { getAction } = await loadClientInboundActions();
    const action = getAction('upsertContactByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { contact: { id: 'contact-42', companyId: 'missing-company' } },
          idempotencyKey: 'contact-42',
        },
        {
          external_id: 'contact-42',
          full_name: 'Jane Admin',
          email: 'jane@example.com',
          client_external_id: 'missing-company',
        },
      ),
    ).rejects.toThrow(
      'VALIDATION_ERROR: upsertContactByExternalId requires client_id or resolvable client_external_id when creating a contact',
    );

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'contact',
      'contact-42',
      { knex: trx },
    );
    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'client',
      'missing-company',
      { knex: trx },
    );
    expect(mocks.createContact).not.toHaveBeenCalled();
    expect(mocks.writeEntityMapping).not.toHaveBeenCalled();
  });
});
