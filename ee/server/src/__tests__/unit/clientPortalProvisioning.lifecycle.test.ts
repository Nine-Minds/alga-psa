import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/auth/oauthAccountLinks', () => ({
  upsertOAuthAccountLink: vi.fn(),
  OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {},
}));

function buildUser(overrides: Partial<EntraSyncUser> = {}): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-lifecycle',
    entraObjectId: 'entra-object-lifecycle',
    userPrincipalName: 'lifecycle@example.com',
    email: 'lifecycle@example.com',
    displayName: 'Lifecycle User',
    givenName: 'Lifecycle',
    surname: 'User',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

function setupLifecycleHarness(existingUser?: { user_id: string; is_inactive: boolean; client_portal_entra_metadata?: Record<string, unknown> | null }) {
  const updates: Array<Record<string, unknown>> = [];

  const usersWhereMock = vi.fn(() => {
    const chain: any = {
      andWhereRaw: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      first: vi.fn(async () => existingUser),
      update: vi.fn(async (payload: Record<string, unknown>) => {
        updates.push(payload);
        return 1;
      }),
    };
    return chain;
  });

  const trxFn: any = vi.fn((table: string) => {
    if (table !== 'users') {
      throw new Error(`Unexpected table ${table}`);
    }
    return { where: usersWhereMock };
  });
  trxFn.fn = { now: vi.fn(() => 'db-now') };

  createTenantKnexMock.mockResolvedValue({
    knex: {
      transaction: vi.fn(async (cb: (trx: any) => Promise<unknown>) => cb(trxFn)),
    },
  });

  return { updates };
}

describe('clientPortalProvisioning lifecycle handling', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
  });

  it('T136/F051: deactivates Entra-managed portal users when entitlement is removed and setting is enabled', async () => {
    const harness = setupLifecycleHarness({
      user_id: 'managed-user-301',
      is_inactive: false,
      client_portal_entra_metadata: { managed: true },
    });

    const { handleIneligibleClientPortalLifecycle } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleIneligibleClientPortalLifecycle(
      {
        tenantId: 'tenant-301',
        clientId: 'client-301',
        managedTenantId: 'managed-301',
        contactNameId: 'contact-301',
      },
      buildUser(),
      { eligible: false, reason: 'missing_entitlement' },
      { deactivateOnEntitlementRemoval: true }
    );

    expect(result).toEqual({ outcome: 'deactivated', reason: 'missing_entitlement' });
    expect(harness.updates[0]).toMatchObject({
      is_inactive: true,
      client_portal_entra_metadata: expect.objectContaining({
        lifecycle: expect.objectContaining({
          state: 'deactivated',
          owner: 'entra_sync',
          reason: 'missing_entitlement',
        }),
      }),
    });
  });

  it('T137/F052: deactivates Entra-managed portal users when account is disabled', async () => {
    const harness = setupLifecycleHarness({
      user_id: 'managed-user-302',
      is_inactive: false,
      client_portal_entra_metadata: { managed: true },
    });

    const { handleIneligibleClientPortalLifecycle } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleIneligibleClientPortalLifecycle(
      {
        tenantId: 'tenant-302',
        clientId: 'client-302',
        managedTenantId: 'managed-302',
        contactNameId: 'contact-302',
      },
      buildUser(),
      { eligible: false, reason: 'account_disabled' }
    );

    expect(result).toEqual({ outcome: 'deactivated', reason: 'account_disabled' });
    expect(harness.updates).toHaveLength(1);
  });

  it('T138/F053: does not deactivate when entitlement is missing but setting is disabled', async () => {
    const harness = setupLifecycleHarness({
      user_id: 'managed-user-303',
      is_inactive: false,
      client_portal_entra_metadata: { managed: true },
    });

    const { handleIneligibleClientPortalLifecycle } = await import('@ee/lib/integrations/entra/sync/clientPortalProvisioning');
    const result = await handleIneligibleClientPortalLifecycle(
      {
        tenantId: 'tenant-303',
        clientId: 'client-303',
        managedTenantId: 'managed-303',
        contactNameId: 'contact-303',
      },
      buildUser(),
      { eligible: false, reason: 'missing_entitlement' },
      { deactivateOnEntitlementRemoval: false }
    );

    expect(result).toEqual({ outcome: 'none' });
    expect(harness.updates).toHaveLength(0);
  });
});
