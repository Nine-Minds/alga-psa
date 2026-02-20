import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const upsertEntraContactLinkActiveMock = vi.fn();
const createContactMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/contactLinkRepository', () => ({
  upsertEntraContactLinkActive: upsertEntraContactLinkActiveMock,
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: createContactMock,
  },
}));

describe('reconciliationQueueService resolve flows', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    upsertEntraContactLinkActiveMock.mockReset();
    createContactMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    upsertEntraContactLinkActiveMock.mockResolvedValue(undefined);
  });

  it('T116: resolving queue to existing contact links identity and marks queue item resolved', async () => {
    const queueFirstMock = vi.fn(async () => ({
      queue_item_id: 'queue-116',
      managed_tenant_id: 'managed-116',
      client_id: 'client-116',
      entra_tenant_id: 'entra-tenant-116',
      entra_object_id: 'entra-object-116',
      user_principal_name: 'user116@example.com',
      display_name: 'User 116',
      email: 'user116@example.com',
      status: 'open',
    }));
    const queueUpdateMock = vi.fn(async () => 1);
    const contactFirstMock = vi.fn(async () => ({
      contact_name_id: 'contact-116',
      client_id: 'client-116',
    }));

    const trxMock = Object.assign(
      vi.fn((table: string) => {
        if (table === 'entra_contact_reconciliation_queue') {
          return {
            where: vi.fn(() => ({
              first: queueFirstMock,
              update: queueUpdateMock,
            })),
          };
        }

        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              first: contactFirstMock,
            })),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      {
        fn: {
          now: vi.fn(() => 'db-now'),
        },
      }
    ) as any;

    createTenantKnexMock.mockResolvedValue({
      knex: {
        transaction: vi.fn(async (cb: (trx: typeof trxMock) => Promise<unknown>) => cb(trxMock)),
      },
    });

    const { resolveEntraQueueToExistingContact } = await import(
      '@ee/lib/integrations/entra/reconciliationQueueService'
    );
    const result = await resolveEntraQueueToExistingContact({
      tenantId: 'tenant-116',
      queueItemId: 'queue-116',
      contactNameId: 'contact-116',
      resolvedBy: 'resolver-116',
    });

    expect(result).toEqual({
      queueItemId: 'queue-116',
      contactNameId: 'contact-116',
    });
    expect(upsertEntraContactLinkActiveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-116',
        clientId: 'client-116',
        contactNameId: 'contact-116',
        user: expect.objectContaining({
          entraTenantId: 'entra-tenant-116',
          entraObjectId: 'entra-object-116',
          email: 'user116@example.com',
        }),
      })
    );
    expect(queueUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolution_action: 'link_existing',
        resolved_contact_id: 'contact-116',
        resolved_by: 'resolver-116',
      })
    );
  });

  it('T117: resolving queue to new contact creates contact, links identity, and resolves queue', async () => {
    const queueFirstMock = vi.fn(async () => ({
      queue_item_id: 'queue-117',
      managed_tenant_id: 'managed-117',
      client_id: 'client-117',
      entra_tenant_id: 'entra-tenant-117',
      entra_object_id: 'entra-object-117',
      user_principal_name: 'user117@example.com',
      display_name: 'User 117',
      email: 'USER117@EXAMPLE.COM',
      status: 'open',
    }));
    const queueUpdateMock = vi.fn(async () => 1);
    createContactMock.mockResolvedValue({ contact_name_id: 'contact-117' });

    const trxMock = Object.assign(
      vi.fn((table: string) => {
        if (table === 'entra_contact_reconciliation_queue') {
          return {
            where: vi.fn(() => ({
              first: queueFirstMock,
              update: queueUpdateMock,
            })),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      {
        fn: {
          now: vi.fn(() => 'db-now'),
        },
      }
    ) as any;

    createTenantKnexMock.mockResolvedValue({
      knex: {
        transaction: vi.fn(async (cb: (trx: typeof trxMock) => Promise<unknown>) => cb(trxMock)),
      },
    });

    const { resolveEntraQueueToNewContact } = await import(
      '@ee/lib/integrations/entra/reconciliationQueueService'
    );
    const result = await resolveEntraQueueToNewContact({
      tenantId: 'tenant-117',
      queueItemId: 'queue-117',
      resolvedBy: 'resolver-117',
    });

    expect(result).toEqual({
      queueItemId: 'queue-117',
      contactNameId: 'contact-117',
    });
    expect(createContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        full_name: 'User 117',
        email: 'user117@example.com',
        client_id: 'client-117',
      }),
      'tenant-117',
      expect.anything()
    );
    expect(upsertEntraContactLinkActiveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-117',
        clientId: 'client-117',
        contactNameId: 'contact-117',
        user: expect.objectContaining({
          entraTenantId: 'entra-tenant-117',
          entraObjectId: 'entra-object-117',
          email: 'USER117@EXAMPLE.COM',
        }),
      })
    );
    expect(queueUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolution_action: 'create_new',
        resolved_contact_id: 'contact-117',
        resolved_by: 'resolver-117',
      })
    );
  });
});
