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
          clientPortalEntraProvisioningMode: 'workflow_managed',
          clientPortalEntitlementGroupId: 'group-63',
          clientPortalWorkflowTarget: 'workflow-63',
          clientPortalWorkflowConfig: { strategy: 'manual_review' },
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
        client_portal_entra_provisioning_mode: 'workflow_managed',
        client_portal_entitlement_group_id: 'group-63',
        client_portal_entitlement_membership_mode: 'transitive',
        client_portal_default_role_name: null,
        client_portal_workflow_target: 'workflow-63',
        client_portal_workflow_config: { strategy: 'manual_review' },
      })
    );
  });

  it('T064: remap deactivates prior active mapping and keeps a single active mapped row', async () => {
    const managedTenantFirstMock = vi.fn(async () => ({
      entra_tenant_id: 'entra-tenant-64',
      primary_domain: 'client64.example.com',
    }));
    const activeMappingFirstMock = vi.fn(async () => ({
      mapping_id: 'mapping-old-64',
      client_id: 'client-old-64',
      mapping_state: 'mapped',
      client_portal_entra_provisioning_mode: 'workflow_managed',
      client_portal_entitlement_group_id: 'group-64',
      client_portal_entitlement_membership_mode: 'transitive',
      client_portal_default_role_name: 'Finance',
      client_portal_workflow_target: 'workflow-64',
      client_portal_workflow_config: { strategy: 'approval' },
    }));
    const deactivateUpdateMock = vi.fn(async () => 1);
    const mappingInsertMock = vi.fn(async () => [1]);

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
          update: vi.fn(async () => 1),
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
      tenant: 'tenant-64',
      userId: 'user-64',
      mappings: [
        {
          managedTenantId: 'managed-64',
          clientId: 'client-new-64',
          mappingState: 'mapped',
        },
      ],
    });

    expect(result).toEqual({ confirmedMappings: 1 });
    expect(deactivateUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
      })
    );
    expect(mappingInsertMock).toHaveBeenCalledTimes(1);
    expect(mappingInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        managed_tenant_id: 'managed-64',
        client_id: 'client-new-64',
        mapping_state: 'mapped',
        client_portal_entra_provisioning_mode: 'workflow_managed',
        client_portal_entitlement_group_id: 'group-64',
        client_portal_default_role_name: 'Finance',
        client_portal_workflow_target: 'workflow-64',
        client_portal_workflow_config: { strategy: 'approval' },
        is_active: true,
      })
    );
  });

  it('T065/T030: defaults per-mapping provisioning mode to inherit when confirm payload omits mode', async () => {
    const managedTenantFirstMock = vi.fn(async () => ({
      entra_tenant_id: 'entra-tenant-65',
      primary_domain: 'client65.example.com',
    }));
    const activeMappingFirstMock = vi.fn(async () => null);
    const deactivateUpdateMock = vi.fn(async () => 1);
    const mappingInsertMock = vi.fn(async () => [1]);

    const trxMock = vi.fn((table: string) => {
      if (table === 'entra_managed_tenants') {
        const chain = { first: managedTenantFirstMock };
        return { where: vi.fn(() => chain) };
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
          update: vi.fn(async () => 1),
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
    await confirmEntraMappings({
      tenant: 'tenant-65',
      userId: 'user-65',
      mappings: [
        {
          managedTenantId: 'managed-65',
          clientId: 'client-65',
          mappingState: 'mapped',
        },
      ],
    });

    expect(mappingInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_portal_entra_provisioning_mode: 'inherit',
        client_portal_entitlement_membership_mode: 'transitive',
        client_portal_default_role_name: null,
      })
    );
  });

  it('preserves an explicit per-client disabled provisioning override', async () => {
    const managedTenantFirstMock = vi.fn(async () => ({
      entra_tenant_id: 'entra-tenant-disabled',
      primary_domain: 'disabled.example.com',
    }));
    const activeMappingFirstMock = vi.fn(async () => null);
    const mappingInsertMock = vi.fn(async () => [1]);

    const trxMock = vi.fn((table: string) => {
      if (table === 'entra_managed_tenants') {
        return { where: vi.fn(() => ({ first: managedTenantFirstMock })) };
      }

      if (table === 'entra_client_tenant_mappings') {
        return {
          where: vi.fn(() => ({
            first: activeMappingFirstMock,
            update: vi.fn(async () => 1),
          })),
          insert: mappingInsertMock,
        };
      }

      if (table === 'clients') {
        return { where: vi.fn(() => ({ update: vi.fn(async () => 1) })) };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    createTenantKnexMock.mockResolvedValue({
      knex: {
        fn: { now: vi.fn(() => 'db-now') },
        transaction: vi.fn(async (cb: (trx: typeof trxMock) => Promise<void>) => cb(trxMock)),
      },
    });

    const { confirmEntraMappings } = await import(
      '@ee/lib/integrations/entra/mapping/confirmMappingsService'
    );
    await confirmEntraMappings({
      tenant: 'tenant-disabled',
      userId: 'user-disabled',
      mappings: [
        {
          managedTenantId: 'managed-disabled',
          clientId: 'client-disabled',
          mappingState: 'mapped',
          clientPortalEntraProvisioningMode: 'disabled',
        },
      ],
    });

    expect(mappingInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_portal_entra_provisioning_mode: 'disabled',
      })
    );
  });
});
