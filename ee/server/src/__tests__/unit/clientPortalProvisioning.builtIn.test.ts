import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const upsertOAuthAccountLinkMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/auth/oauthAccountLinks', () => ({
  upsertOAuthAccountLink: upsertOAuthAccountLinkMock,
  OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {},
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
    contact_id: string | null;
    is_inactive?: boolean;
    client_portal_entra_metadata?: Record<string, unknown> | null;
  }>;
  existingMicrosoftLinkUserId?: string | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];

  const usersWhereMock = vi.fn(() => {
    const selectOrderByMock = vi.fn(async () => params.existingContactUsers ?? []);
    const emailSelectOrderByMock = vi.fn(async () => params.emailMatches ?? []);
    const chain: any = {
      select: vi.fn(() => ({
        orderBy: selectOrderByMock,
      })),
      andWhereRaw: vi.fn(() => ({
        select: vi.fn(() => ({
          orderBy: emailSelectOrderByMock,
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
  const userAuthAccountsWhereMock = vi.fn(() => ({
    first: vi.fn(async () =>
      params.existingMicrosoftLinkUserId ? { user_id: params.existingMicrosoftLinkUserId } : undefined
    ),
  }));
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
    throw new Error(`Unexpected table ${table}`);
  });

  trxFn.fn = { now: vi.fn(() => 'db-now') };
  trxFn.raw = vi.fn((value: string) => value);

  createTenantKnexMock.mockResolvedValue({
    knex: {
      transaction: vi.fn(async (cb: (trx: any) => Promise<unknown>) => cb(trxFn)),
    },
  });

  return { updates, inserts };
}

describe('clientPortalProvisioning built-in mutations', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    upsertOAuthAccountLinkMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    upsertOAuthAccountLinkMock.mockResolvedValue(undefined);
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
      },
      buildUser()
    );

    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-201',
        userId: 'existing-user-201',
        provider: 'microsoft',
        providerAccountId: 'entra-object-201',
      })
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
      expect.objectContaining({ userId: 'email-user-202', providerAccountId: 'entra-object-202' })
    );
  });

  it('T124/F043/F044/F045: creates a client portal user for entitled reconciled contact when no existing user is found', async () => {
    const harness = setupKnexHarness({
      existingContactUsers: [],
      emailMatches: [],
    });

    const { handleEligibleClientPortalProvisioning } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    await handleEligibleClientPortalProvisioning(
      {
        tenantId: 'tenant-203',
        clientId: 'client-203',
        managedTenantId: 'managed-203',
        contactNameId: 'contact-203',
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
      is_inactive: false,
      client_portal_entra_metadata: expect.objectContaining({
        managed: true,
        managedTenantId: 'managed-203',
        entraTenantId: 'entra-tenant-201',
      }),
    });
    expect(harness.inserts[0]).not.toHaveProperty('hashed_password');
    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'created-user-201', providerAccountId: 'entra-object-203' })
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
      },
      buildUser({ entraObjectId: 'entra-object-204' })
    );

    expect(result).toEqual({ outcome: 'skipped_conflict', reason: 'contact_conflict' });
    expect(upsertOAuthAccountLinkMock).not.toHaveBeenCalled();
  });

  it('T130/F049: returns conflict skip when Microsoft account link already belongs to another user', async () => {
    setupKnexHarness({
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
      },
      buildUser({ entraObjectId: 'entra-object-205', email: 'user205@example.com' })
    );

    expect(result).toEqual({ outcome: 'skipped_conflict', reason: 'oauth_link_conflict' });
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
      },
      buildUser({ entraObjectId: 'entra-object-207', email: 'user207@example.com' })
    );

    expect(harness.updates[0]).toMatchObject({
      is_inactive: 'is_inactive',
    });
  });
});
