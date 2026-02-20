import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

describe('confirmEntraMappings client linkage updates', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
  });

  it('T063: confirm mappings updates mapped client rows with Entra tenant and primary domain', async () => {
    const managedTenantFirstMock = vi.fn(async () => ({
      entra_tenant_id: 'entra-tenant-63',
      primary_domain: 'client63.example.com',
    }));
    const activeMappingFirstMock = vi.fn(async () => null);
    const deactivateUpdateMock = vi.fn(async () => 1);
    const mappingInsertMock = vi.fn(async () => [1]);
    const clientsUpdateMock = vi.fn(async () => 1);

    const trxMock = vi.fn((table: string) => {
      if (table === 'entra_managed_tenants') {
        const chain = {
          first: managedTenantFirstMock,
        };
        return {
          where: vi.fn(() => chain),
        };
      }

      if (table === 'entra_client_tenant_mappings') {
        const chain = {
          first: activeMappingFirstMock,
          update: deactivateUpdateMock,
        };
        return {
          where: vi.fn(() => chain),
          insert: mappingInsertMock,
        };
      }

      if (table === 'clients') {
        const chain = {
          update: clientsUpdateMock,
        };
        return {
          where: vi.fn(() => chain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const knexMock = {
      fn: { now: vi.fn(() => 'db-now') },
      transaction: vi.fn(async (cb: (trx: typeof trxMock) => Promise<void>) => cb(trxMock)),
    };
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { confirmEntraMappings } = await import(
      '@ee/lib/integrations/entra/mapping/confirmMappingsService'
    );
    const result = await confirmEntraMappings({
      tenant: 'tenant-63',
      userId: 'user-63',
      mappings: [
        {
          managedTenantId: 'managed-63',
          clientId: 'client-63',
          mappingState: 'mapped',
        },
      ],
    });

    expect(result).toEqual({ confirmedMappings: 1 });

    expect(clientsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entra_tenant_id: 'entra-tenant-63',
        entra_primary_domain: 'client63.example.com',
      })
    );
    expect(mappingInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        managed_tenant_id: 'managed-63',
        client_id: 'client-63',
        mapping_state: 'mapped',
      })
    );
  });
});
