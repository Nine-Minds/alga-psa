import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const upsertOAuthAccountLinkMock = vi.fn();
const hashPasswordMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/auth/oauthAccountLinks', () => ({
  upsertOAuthAccountLink: upsertOAuthAccountLinkMock,
  OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {},
}));

vi.mock('@alga-psa/core/encryption', () => ({
  hashPassword: hashPasswordMock,
}));

function buildUser(overrides: Partial<EntraSyncUser> = {}): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-201',
    entraObjectId: 'entra-object-201',
    userPrincipalName: 'user201@example.com',
    email: 'user201@example.com',
    displayName: 'User 201',
    givenName: 'User',
    surname: 'TwoZeroOne',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

function setupKnexHarness(params: {
  existingContactUsers?: Array<{
    user_id: string;
    email: string;
    is_inactive?: boolean;
    client_portal_entra_metadata?: Record<string, unknown> | null;
  }>;
  emailMatches?: Array<{
    user_id: string;
    email?: string;
    contact_id: string | null;
    is_inactive?: boolean;
    client_portal_entra_metadata?: Record<string, unknown> | null;
  }>;
  emailConflictUserId?: string | null;
  existingMicrosoftLinkUserId?: string | null;
  roleIdForDefaultRole?: string | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const userRoleInserts: Array<Record<string, unknown>> = [];

  const usersWhereMock = vi.fn(() => {
    const selectOrderByMock = vi.fn(async () => params.existingContactUsers ?? []);
    const emailSelectOrderByMock = vi.fn(async () => params.emailMatches ?? []);
    const emailConflictFirstMock = vi.fn(async () =>
      params.emailConflictUserId ? { user_id: params.emailConflictUserId } : undefined
    );
    const chain: any = {
      select: vi.fn(() => ({
        orderBy: selectOrderByMock,
      })),
      andWhereRaw: vi.fn(() => ({
        select: vi.fn(() => ({
          orderBy: emailSelectOrderByMock,
        })),
        first: vi.fn(async () =>
          params.emailConflictUserId ? { user_id: params.emailConflictUserId } : undefined
        ),
        whereNot: vi.fn((_field: string, value: string) => ({
          first: vi.fn(async () =>
            params.emailConflictUserId && params.emailConflictUserId !== value
              ? emailConflictFirstMock()
              : undefined
          ),
        })),
      })),
      update: vi.fn(async (payload: Record<string, unknown>) => {
        updates.push(payload);
        return 1;
      }),
    };
    return chain;
  });

  const usersInsertMock = vi.fn((payload: Record<string, unknown>) => {
    inserts.push(payload);
    return {
      returning: vi.fn(async () => [{ user_id: 'created-user-201' }]),
    };
  });

  const trxFn: any = vi.fn((table: string) => {
    if (table !== 'users') {
      throw new Error(`Unexpected table ${table}`);
    }
    return {
      where: usersWhereMock,
      insert: usersInsertMock,
    };
  });
  const userAuthAccountsWhereMock = vi.fn(() => {
    let excludedUserId: string | null = null;
    const chain: any = {
      whereNot: vi.fn((_field: string, value: string) => {
        excludedUserId = value;
        return chain;
      }),
      first: vi.fn(async () =>
        params.existingMicrosoftLinkUserId &&
        params.existingMicrosoftLinkUserId !== excludedUserId
          ? { user_id: params.existingMicrosoftLinkUserId }
          : undefined
      ),
    };
    return chain;
  });
  trxFn.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        where: usersWhereMock,
        insert: usersInsertMock,
      };
    }
    if (table === 'user_auth_accounts') {
      return {
        where: userAuthAccountsWhereMock,
      };
    }
    if (table === 'roles') {
      return {
        where: vi.fn(() => ({
          andWhereRaw: vi.fn(() => ({
            first: vi.fn(async () =>
              params.roleIdForDefaultRole ? { role_id: params.roleIdForDefaultRole } : undefined
            ),
          })),
        })),
      };
    }
    if (table === 'user_roles') {
      return {
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          userRoleInserts.push(payload);
          return [1];
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  trxFn.fn = { now: vi.fn(() => 'db-now') };
  trxFn.raw = vi.fn((value: string) => value);

  createTenantKnexMock.mockResolvedValue({
    knex: {
      transaction: vi.fn(async (cb: (trx: any) => Promise<unknown>) => cb(trxFn)),
    },
  });

  return { updates, inserts, userRoleInserts };
}

describe('clientPortalProvisioning built-in mutations', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    upsertOAuthAccountLinkMock.mockReset();
    hashPasswordMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    upsertOAuthAccountLinkMock.mockResolvedValue(undefined);
    hashPasswordMock.mockResolvedValue('hashed-unusable-sso-password');
  });

  it('T122/F041/F046: uses existing client portal user linked to reconciled contact and upserts Microsoft OAuth link', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [{ user_id: 'existing-user-201', email: 'user201@example.com' }],
      emailMatches: [],
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-201',
        clientId: 'client-201',
        managedTenantId: 'managed-201',
        contactNameId: 'contact-201',
        defaultRoleName: 'User',
      },
      buildUser()
    );

    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-201',
        userId: 'existing-user-201',
        provider: 'microsoft',
        providerAccountId: 'entra-object-201',
      }),
      expect.any(Function)
    );
    expect(harness.updates[0]).toMatchObject({
      is_inactive: 'is_inactive',
      client_portal_entra_metadata: expect.objectContaining({
        managed: true,
        entraTenantId: 'entra-tenant-201',
        entraObjectId: 'entra-object-201',
      }),
    });
  });

  it('T123/F042: safely links an existing tenant client user by email when it has no conflicting contact linkage', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [],
      emailMatches: [{ user_id: 'email-user-202', contact_id: null }],
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-202',
        clientId: 'client-202',
        managedTenantId: 'managed-202',
        contactNameId: 'contact-202',
        defaultRoleName: 'User',
      },
      buildUser({ entraObjectId: 'entra-object-202', email: 'user202@example.com', userPrincipalName: 'user202@example.com' })
    );

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]).toMatchObject({
      contact_id: 'contact-202',
      email: 'user202@example.com',
      username: 'user202@example.com',
      is_inactive: 'is_inactive',
      client_portal_entra_metadata: expect.objectContaining({
        managed: true,
        managedTenantId: 'managed-202',
        entraObjectId: 'entra-object-202',
      }),
    });
    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'email-user-202', providerAccountId: 'entra-object-202' }),
      expect.any(Function)
    );
  });

  it('T124/F043/F044/F045: creates a client portal user for entitled reconciled contact when no existing user is found', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [],
      emailMatches: [],
      roleIdForDefaultRole: 'role-user-203',
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-203',
        clientId: 'client-203',
        managedTenantId: 'managed-203',
        contactNameId: 'contact-203',
        defaultRoleName: 'User',
      },
      buildUser({
        entraObjectId: 'entra-object-203',
        email: 'user203@example.com',
        userPrincipalName: 'user203@example.com',
      })
    );

    expect(harness.inserts).toHaveLength(1);
    expect(harness.inserts[0]).toMatchObject({
      tenant: 'tenant-203',
      user_type: 'client',
      contact_id: 'contact-203',
      email: 'user203@example.com',
      username: 'user203@example.com',
      hashed_password: 'hashed-unusable-sso-password',
      is_inactive: false,
      client_portal_entra_metadata: expect.objectContaining({
        managed: true,
        managedTenantId: 'managed-203',
        entraTenantId: 'entra-tenant-201',
      }),
    });
    expect(hashPasswordMock).toHaveBeenCalledTimes(1);
    expect(harness.userRoleInserts).toEqual([
      {
        tenant: 'tenant-203',
        user_id: 'created-user-201',
        role_id: 'role-user-203',
      },
    ]);
    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'created-user-201', providerAccountId: 'entra-object-203' }),
      expect.any(Function)
    );
  });

  it('T129/F049: returns conflict skip when multiple client portal users already map to the reconciled contact', async () => {
    setupKnexHarness({
      existingContactUsers: [
        { user_id: 'user-a', email: 'dup@example.com' },
        { user_id: 'user-b', email: 'dup@example.com' },
      ],
      emailMatches: [],
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-204',
        clientId: 'client-204',
        managedTenantId: 'managed-204',
        contactNameId: 'contact-204',
        defaultRoleName: 'User',
      },
      buildUser({ entraObjectId: 'entra-object-204' })
    );

    expect(result).toEqual({ outcome: 'skipped_conflict', reason: 'contact_conflict' });
    expect(upsertOAuthAccountLinkMock).not.toHaveBeenCalled();
  });

  it('T130/F049: returns conflict skip when Microsoft account link already belongs to another user', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [{ user_id: 'contact-user-205', email: 'user205@example.com' }],
      emailMatches: [],
      existingMicrosoftLinkUserId: 'different-user-205',
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-205',
        clientId: 'client-205',
        managedTenantId: 'managed-205',
        contactNameId: 'contact-205',
        defaultRoleName: 'User',
      },
      buildUser({ entraObjectId: 'entra-object-205', email: 'user205@example.com' })
    );

    expect(result).toEqual({ outcome: 'skipped_conflict', reason: 'oauth_link_conflict' });
    expect(harness.updates).toEqual([]);
    expect(harness.inserts).toEqual([]);
    expect(harness.userRoleInserts).toEqual([]);
    expect(upsertOAuthAccountLinkMock).not.toHaveBeenCalled();
  });

  it('skips existing contact-linked portal user update when the target email belongs to another tenant user', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [{ user_id: 'contact-user-208', email: 'old208@example.com' }],
      emailMatches: [],
      emailConflictUserId: 'other-user-208',
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-208',
        clientId: 'client-208',
        managedTenantId: 'managed-208',
        contactNameId: 'contact-208',
        defaultRoleName: 'User',
      },
      buildUser({
        entraObjectId: 'entra-object-208',
        email: 'new208@example.com',
        userPrincipalName: 'new208@example.com',
      })
    );

    expect(result).toEqual({ outcome: 'skipped_conflict', reason: 'email_conflict' });
    expect(harness.updates).toEqual([]);
    expect(harness.inserts).toEqual([]);
    expect(harness.userRoleInserts).toEqual([]);
    expect(upsertOAuthAccountLinkMock).not.toHaveBeenCalled();
  });

  it('skips new portal user provisioning when the target email belongs to another tenant user', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [],
      emailMatches: [],
      emailConflictUserId: 'internal-user-209',
      roleIdForDefaultRole: 'role-user-209',
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-209',
        clientId: 'client-209',
        managedTenantId: 'managed-209',
        contactNameId: 'contact-209',
        defaultRoleName: 'User',
      },
      buildUser({
        entraObjectId: 'entra-object-209',
        email: 'internal209@example.com',
        userPrincipalName: 'internal209@example.com',
      })
    );

    expect(result).toEqual({ outcome: 'skipped_conflict', reason: 'email_conflict' });
    expect(harness.updates).toEqual([]);
    expect(harness.inserts).toEqual([]);
    expect(harness.userRoleInserts).toEqual([]);
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(upsertOAuthAccountLinkMock).not.toHaveBeenCalled();
  });

  it('T134/F055: reactivates lifecycle-deactivated Entra-managed portal users when entitlement returns', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [{
        user_id: 'managed-inactive-206',
        email: 'user206@example.com',
        is_inactive: true,
        client_portal_entra_metadata: {
          managed: true,
          lifecycle: { state: 'deactivated', owner: 'entra_sync', reason: 'missing_entitlement' },
        },
      }],
      emailMatches: [],
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-206',
        clientId: 'client-206',
        managedTenantId: 'managed-206',
        contactNameId: 'contact-206',
        defaultRoleName: 'User',
      },
      buildUser({ entraObjectId: 'entra-object-206', email: 'user206@example.com' })
    );

    expect(harness.updates[0]).toMatchObject({
      is_inactive: false,
      client_portal_entra_metadata: expect.objectContaining({
        lifecycle: expect.objectContaining({
          state: 'active',
          owner: 'entra_sync',
          reason: 'entitlement_restored',
        }),
      }),
    });
    expect(harness.userRoleInserts).toHaveLength(0);
  });

  it('T135/F053: does not reactivate manually deactivated portal users during entitlement return', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [{
        user_id: 'manual-inactive-207',
        email: 'user207@example.com',
        is_inactive: true,
        client_portal_entra_metadata: {
          managed: true,
          lifecycle: { state: 'deactivated', owner: 'manual', reason: 'staff_action' },
        },
      }],
      emailMatches: [],
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-207',
        clientId: 'client-207',
        managedTenantId: 'managed-207',
        contactNameId: 'contact-207',
        defaultRoleName: 'User',
      },
      buildUser({ entraObjectId: 'entra-object-207', email: 'user207@example.com' })
    );

    expect(harness.updates[0]).toMatchObject({
      is_inactive: 'is_inactive',
    });
  });

  it('T021/F063/F064/F065: assigns configured default role only for newly created users', async () => {
    const createHarness = setupKnexHarness({
      existingContactUsers: [],
      emailMatches: [],
      roleIdForDefaultRole: 'role-admin-entra',
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-221',
        clientId: 'client-221',
        managedTenantId: 'managed-221',
        contactNameId: 'contact-221',
        defaultRoleName: 'Admin',
      },
      buildUser({
        entraObjectId: 'entra-object-221',
        email: 'user221@example.com',
        userPrincipalName: 'user221@example.com',
      })
    );
    expect(createHarness.userRoleInserts).toEqual([
      {
        tenant: 'tenant-221',
        user_id: 'created-user-201',
        role_id: 'role-admin-entra',
      },
    ]);

    const existingHarness = setupKnexHarness({
      existingContactUsers: [{ user_id: 'existing-user-221', email: 'user221@example.com' }],
      emailMatches: [],
      roleIdForDefaultRole: 'role-user-entra',
    });
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-221',
        clientId: 'client-221',
        managedTenantId: 'managed-221',
        contactNameId: 'contact-221',
        defaultRoleName: 'User',
      },
      buildUser({
        entraObjectId: 'entra-object-221',
        email: 'user221@example.com',
        userPrincipalName: 'user221@example.com',
      })
    );
    expect(existingHarness.userRoleInserts).toHaveLength(0);
  });

  it('skips new portal user provisioning when configured default role does not exist', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [],
      emailMatches: [],
      roleIdForDefaultRole: null,
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-role-missing',
        clientId: 'client-role-missing',
        managedTenantId: 'managed-role-missing',
        contactNameId: 'contact-role-missing',
        defaultRoleName: 'Missing Role',
      },
      buildUser({
        entraObjectId: 'entra-object-role-missing',
        email: 'role-missing@example.com',
        userPrincipalName: 'role-missing@example.com',
      })
    );

    expect(result).toEqual({ outcome: 'skipped_conflict', reason: 'role_conflict' });
    expect(harness.inserts).toEqual([]);
    expect(harness.userRoleInserts).toEqual([]);
    expect(upsertOAuthAccountLinkMock).not.toHaveBeenCalled();
  });
});
