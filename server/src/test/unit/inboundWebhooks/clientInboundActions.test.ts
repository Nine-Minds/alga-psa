import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
  writeEntityMapping: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@/lib/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
  writeEntityMapping: mocks.writeEntityMapping,
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: mocks.createContact,
    updateContact: mocks.updateContact,
  },
}));

async function loadClientInboundActions() {
  vi.resetModules();
  await import('@alga-psa/clients/actions/inboundActions');
  return import('@/lib/inboundWebhooks/actions/registry');
}

describe('client inbound webhook actions', () => {
  let trx: ReturnType<typeof vi.fn>;
  let clientsQuery: {
    insert: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clientsQuery = {
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
});
