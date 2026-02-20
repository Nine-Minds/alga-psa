import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();
const featureFlagIsEnabledMock = vi.fn();
const createTenantKnexMock = vi.fn();
const startEntraAllTenantsSyncWorkflowMock = vi.fn();
const startEntraTenantSyncWorkflowMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: {
    isEnabled: featureFlagIsEnabledMock,
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@enterprise/lib/integrations/entra/entraWorkflowClient', () => ({
  startEntraAllTenantsSyncWorkflow: startEntraAllTenantsSyncWorkflowMock,
  startEntraTenantSyncWorkflow: startEntraTenantSyncWorkflowMock,
}));

describe('startEntraSync action workflow triggers', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    featureFlagIsEnabledMock.mockReset();
    createTenantKnexMock.mockReset();
    startEntraAllTenantsSyncWorkflowMock.mockReset();
    startEntraTenantSyncWorkflowMock.mockReset();
  });

  it('T084: all-tenants manual sync action starts all-tenants workflow type', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);
    startEntraAllTenantsSyncWorkflowMock.mockResolvedValue({
      available: true,
      workflowId: 'wf-84',
      runId: 'run-84',
      error: null,
    });

    const { startEntraSync } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );
    const result = await startEntraSync(
      { user_id: 'user-84', user_type: 'internal' } as any,
      { tenant: 'tenant-84' },
      { scope: 'all-tenants' }
    );

    expect(result).toEqual({
      success: true,
      data: {
        accepted: true,
        scope: 'all-tenants',
        runId: 'run-84',
        workflowId: 'wf-84',
        error: null,
      },
    });
    expect(startEntraAllTenantsSyncWorkflowMock).toHaveBeenCalledWith({
      tenantId: 'tenant-84',
      actor: { userId: 'user-84' },
      trigger: 'manual',
    });
  });

  it('T085: single-client sync action starts single-tenant workflow type with mapped tenant context', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);
    startEntraTenantSyncWorkflowMock.mockResolvedValue({
      available: true,
      workflowId: 'wf-85',
      runId: 'run-85',
      error: null,
    });

    const firstMock = vi.fn(async () => ({ managed_tenant_id: 'managed-85' }));
    const whereMock = vi.fn().mockReturnThis();
    const joinMock = vi.fn().mockReturnThis();
    const knexMock = vi.fn(() => ({
      join: joinMock,
      where: whereMock,
      first: firstMock,
    }));
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { startEntraSync } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );
    const result = await startEntraSync(
      { user_id: 'user-85', user_type: 'internal' } as any,
      { tenant: 'tenant-85' },
      { scope: 'single-client', clientId: 'client-85' }
    );

    expect(result).toEqual({
      success: true,
      data: {
        accepted: true,
        scope: 'single-client',
        runId: 'run-85',
        workflowId: 'wf-85',
        error: null,
      },
    });
    expect(startEntraTenantSyncWorkflowMock).toHaveBeenCalledWith({
      tenantId: 'tenant-85',
      managedTenantId: 'managed-85',
      clientId: 'client-85',
      actor: { userId: 'user-85' },
    });
  });

  it('T119: single-client sync enforces mapped-tenant scope and rejects unmapped client contexts', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);

    const firstMock = vi.fn(async () => null);
    const whereMock = vi.fn().mockReturnThis();
    const joinMock = vi.fn().mockReturnThis();
    const knexMock = vi.fn(() => ({
      join: joinMock,
      where: whereMock,
      first: firstMock,
    }));
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { startEntraSync } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );
    const result = await startEntraSync(
      { user_id: 'user-119', user_type: 'internal' } as any,
      { tenant: 'tenant-119' },
      { scope: 'single-client', clientId: 'client-119' }
    );

    expect(whereMock).toHaveBeenCalledWith(
      expect.objectContaining({
        'm.tenant': 'tenant-119',
        'm.client_id': 'client-119',
        'm.is_active': true,
        'm.mapping_state': 'mapped',
      })
    );
    expect(result).toEqual({
      success: false,
      error: 'No active Entra mapping exists for this client.',
    });
    expect(startEntraTenantSyncWorkflowMock).not.toHaveBeenCalled();
  });
});
