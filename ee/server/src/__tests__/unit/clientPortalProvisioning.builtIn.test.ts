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
  existingContactUser?: { user_id: string; email: string } | null;
  emailMatches?: Array<{ user_id: string; contact_id: string | null }>;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];

  const usersWhereMock = vi.fn(() => {
    const chain: any = {
      orderBy: vi.fn(() => chain),
      first: vi.fn(async () => params.existingContactUser ?? null),
      andWhereRaw: vi.fn(() => ({
        select: vi.fn(() => ({
          orderBy: vi.fn(async () => params.emailMatches ?? []),
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
    setupKnexHarness({
      existingContactUser: { user_id: 'existing-user-201', email: 'user201@example.com' },
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
  });

  it('T123/F042: safely links an existing tenant client user by email when it has no conflicting contact linkage', async () => {
    const harness = setupKnexHarness({
      existingContactUser: null,
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
      is_inactive: false,
    });
    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'email-user-202', providerAccountId: 'entra-object-202' })
    );
  });

  it('T124/F043/F044/F045: creates a client portal user for entitled reconciled contact when no existing user is found', async () => {
    const harness = setupKnexHarness({
      existingContactUser: null,
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
    });
    expect(upsertOAuthAccountLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'created-user-201', providerAccountId: 'entra-object-203' })
    );
  });
});
