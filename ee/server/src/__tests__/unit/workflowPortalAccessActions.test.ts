import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const upsertOAuthAccountLinkMock = vi.fn();
const handleEligibleClientPortalProvisioningMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/auth/oauthAccountLinks', () => ({
  upsertOAuthAccountLink: upsertOAuthAccountLinkMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/clientPortalProvisioning', () => ({
  handleEligibleClientPortalProvisioning: handleEligibleClientPortalProvisioningMock,
}));

function buildUser(overrides: Partial<EntraSyncUser> = {}): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-401',
    entraObjectId: 'entra-object-401',
    userPrincipalName: 'user401@example.com',
    email: 'user401@example.com',
    displayName: 'User 401',
    givenName: 'User',
    surname: 'FourZeroOne',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

describe('workflow portal access actions', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    upsertOAuthAccountLinkMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
  });

  it('T025/F072: reuses built-in safe provisioning primitive for workflow create/link operation', async () => {
    handleEligibleClientPortalProvisioningMock.mockResolvedValue({ outcome: 'provisioned' });
    const { workflowCreateOrLinkClientPortalUser } = await import('@ee/lib/integrations/entra/sync/workflowPortalAccessActions');

    await workflowCreateOrLinkClientPortalUser({
      tenantId: 'tenant-401',
      clientId: 'client-401',
      managedTenantId: 'managed-401',
      contactNameId: 'contact-401',
      defaultRoleName: 'User',
      user: buildUser(),
    });

    expect(handleEligibleClientPortalProvisioningMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-401', contactNameId: 'contact-401' }),
      expect.objectContaining({ entraObjectId: 'entra-object-401' })
    );
  });

  it('T025/F073: idempotently assigns client role and upserts Microsoft OAuth link', async () => {
    const userRoleInsertMock = vi.fn(async () => [1]);
    const trxMock: any = vi.fn((table: string) => {
      if (table === 'roles') {
        return {
          where: vi.fn(() => ({
            andWhereRaw: vi.fn(() => ({ first: vi.fn(async () => ({ role_id: 'role-402' })) })),
          })),
        };
      }
      if (table === 'user_roles') {
        return {
          where: vi.fn(() => ({ first: vi.fn(async () => undefined) })),
          insert: userRoleInsertMock,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    trxMock.fn = { now: vi.fn(() => 'db-now') };

    createTenantKnexMock.mockResolvedValue({
      knex: { transaction: vi.fn(async (cb: (trx: any) => Promise<unknown>) => cb(trxMock)) },
    });

    const { workflowAssignClientPortalRole, workflowUpsertMicrosoftOAuthLink } = await import('@ee/lib/integrations/entra/sync/workflowPortalAccessActions');

    const roleResult = await workflowAssignClientPortalRole({
      tenantId: 'tenant-402',
      userId: 'user-402',
      roleName: 'User',
    });

    expect(roleResult).toEqual({ assigned: true, roleId: 'role-402' });
    expect(userRoleInsertMock).toHaveBeenCalledWith({
      tenant: 'tenant-402',
      user_id: 'user-402',
      role_id: 'role-402',
    });

    await workflowUpsertMicrosoftOAuthLink({
      tenantId: 'tenant-402',
      userId: 'user-402',
      entraObjectId: 'entra-object-402',
      entraTenantId: 'entra-tenant-402',
      email: 'user402@example.com',
    });

    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'microsoft', providerAccountId: 'entra-object-402' })
    );
  });

  it('T025/F074: deactivates and reactivates only Entra-managed lifecycle-owned users', async () => {
    const updateMock = vi.fn(async () => 1);
    const firstMock = vi
      .fn()
      .mockResolvedValueOnce({
        user_id: 'user-403',
        is_inactive: false,
        client_portal_entra_metadata: { managed: true },
      })
      .mockResolvedValueOnce({
        user_id: 'user-403',
        is_inactive: true,
        client_portal_entra_metadata: { managed: true, lifecycle: { state: 'deactivated', owner: 'entra_sync' } },
      });

    const trxMock: any = vi.fn((table: string) => {
      if (table === 'users') {
        const chain: any = {
          andWhereRaw: vi.fn(() => chain),
          first: firstMock,
          update: updateMock,
        };
        return {
          where: vi.fn(() => chain),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    trxMock.fn = { now: vi.fn(() => 'db-now') };

    createTenantKnexMock.mockResolvedValue({
      knex: { transaction: vi.fn(async (cb: (trx: any) => Promise<unknown>) => cb(trxMock)) },
    });

    const { workflowSetEntraManagedPortalAccessState } = await import('@ee/lib/integrations/entra/sync/workflowPortalAccessActions');

    const deactivate = await workflowSetEntraManagedPortalAccessState({
      tenantId: 'tenant-403',
      entraTenantId: 'entra-tenant-403',
      entraObjectId: 'entra-object-403',
      active: false,
      reason: 'removed',
    });
    const reactivate = await workflowSetEntraManagedPortalAccessState({
      tenantId: 'tenant-403',
      entraTenantId: 'entra-tenant-403',
      entraObjectId: 'entra-object-403',
      active: true,
      reason: 'restored',
    });

    expect(deactivate).toEqual({ outcome: 'deactivated' });
    expect(reactivate).toEqual({ outcome: 'reactivated' });
    expect(updateMock).toHaveBeenCalledTimes(2);
  });
});
