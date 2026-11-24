import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const verifyTokenMock = vi.fn();
const markTokenAsUsedMock = vi.fn();
const cleanupExpiredTokensMock = vi.fn();

/**
 * alga-2026-0003347. Two decisions of the setup path are recorded here:
 *
 * - the role a new portal account is created with comes from the contact's
 *   portal-admin pre-mark (resolveInitialPortalRoleId), and it is written in the
 *   same transaction as the account, so a role that cannot be resolved rolls the
 *   account back instead of leaving an account with no role at all;
 * - relinking an orphaned account to a live contact changes users.contact_id
 *   without writing a role, so the flag of the contact it now points at is
 *   re-derived from the roles that account already holds.
 *
 * Both helpers are faked against these fixtures, mirroring their contracts; the
 * real decision table lives in packages/db/src/lib/clientPortalAdminFlag.test.ts.
 */
const portalRoleFixture = vi.hoisted(() => ({
  initialRoleId: 'client-user-role' as string | null,
  roleWrites: [] as Array<{ tenant: string; userId: string; roleIds: string[] }>,
  resolverCalls: [] as Array<{ tenant: string; contactId: string }>,
  linkSyncs: [] as Array<{ tenant: string; userId: string; previousContactId: string | null }>,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
  getTenantSlugForTenant: vi.fn(),
  lockClientPortalMutations: vi.fn(async () => {}),
  assertClientPortalContactAvailable: vi.fn(async () => {}),
  // The action reaches tables through tenantDb; the harness below still models
  // the raw knex surface, so scope resolution is a pass-through here.
  tenantDb: (conn: any) => ({
    table: (tableName: string) => conn(tableName),
    unscoped: (tableName: string) => conn(tableName),
    tenantJoin: (query: any) => query,
  }),
  withTransaction: async (conn: any, callback: (trx: any) => Promise<unknown>) => conn.transaction(callback),
  resolveInitialPortalRoleId: vi.fn(async (_trx: unknown, tenant: string, contactId: string) => {
    portalRoleFixture.resolverCalls.push({ tenant, contactId });
    return portalRoleFixture.initialRoleId;
  }),
  addUserRoles: vi.fn(async (_trx: unknown, tenant: string, userId: string, roleIds: string[]) => {
    portalRoleFixture.roleWrites.push({ tenant, userId, roleIds });
    return roleIds.map((role_id) => ({ tenant, user_id: userId, role_id }));
  }),
  syncContactClientAdminFlagsForUserLinkChange: vi.fn(async (
    _trx: unknown,
    tenant: string,
    userId: string,
    previousContactId: string | null
  ) => {
    portalRoleFixture.linkSyncs.push({ tenant, userId, previousContactId });
  }),
  UserPreferences: {
    upsert: vi.fn(),
  },
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  getTenantPortalBaseUrl: vi.fn(async () => 'https://portal.test'),
}), { virtual: true });

vi.mock('../../../../../packages/portal-shared/src/services/PortalInvitationService', () => ({
  PortalInvitationService: {
    verifyToken: verifyTokenMock,
    markTokenAsUsed: markTokenAsUsedMock,
    cleanupExpiredTokens: cleanupExpiredTokensMock,
  },
}));

vi.mock('@alga-psa/email', () => ({
  getSystemEmailService: vi.fn(),
  TenantEmailService: vi.fn(),
  sendPortalInvitationEmail: vi.fn(),
}), { virtual: true });

vi.mock('@alga-psa/auth', () => ({
  hasPermission: vi.fn(async () => true),
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/core', () => ({
  isValidEmail: () => true,
}));

vi.mock('@alga-psa/core/encryption', () => ({
  hashPassword: async (password: string) => `hashed:${password}`,
}), { virtual: true });

interface EmailOwner {
  user_id: string;
  user_type: string | null;
  contact_id: string | null;
  username?: string | null;
  linked_contact_id: string | null;
}

function buildKnexHarness(params: {
  existingContactUser?: { user_id: string } | null;
  emailOwner?: EmailOwner | null;
  createdUserId?: string;
}) {
  const transactionMock = vi.fn();
  const preferenceInserts: Array<Record<string, unknown>> = [];
  const usersInsertMock = vi.fn((values: Record<string, unknown>) => ({
    returning: vi.fn(async () => [{ ...values, user_id: params.createdUserId ?? 'created-user-1' }]),
  }));
  const usersUpdateMock = vi.fn(async () => 1);

  const knexMock: any = vi.fn((table: string) => {
    if (table === 'contacts') {
      return {
        where: vi.fn(() => ({
          first: vi.fn(async () => ({ contact_kind: 'person' })),
        })),
      };
    }

    if (table === 'user_preferences') {
      return {
        insert: vi.fn(async (values: Record<string, unknown>) => {
          preferenceInserts.push(values);
          return 1;
        }),
      };
    }

    if (table === 'users') {
      return {
        where: vi.fn((conditions: Record<string, unknown>) => ({
          first: vi.fn(async () =>
            conditions.contact_id ? params.existingContactUser ?? undefined : undefined
          ),
          update: (values: Record<string, unknown>) => usersUpdateMock(conditions, values),
        })),
        insert: usersInsertMock,
      };
    }

    // The email-owner probe: users left-joined to contacts, so a deleted contact
    // shows up as linked_contact_id = null.
    if (table === 'users as u') {
      return {
        whereRaw: vi.fn(() => ({
          select: vi.fn(() => ({
            first: vi.fn(() => Promise.resolve(params.emailOwner ?? undefined)),
          })),
        })),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });
  knexMock.transaction = transactionMock;
  knexMock.raw = vi.fn((sql: string) => ({ sql }));

  return {
    knexMock,
    transactionMock,
    usersInsertMock,
    usersUpdateMock,
    preferenceInserts,
  };
}

const contactPayload = {
  contact_name_id: 'contact-1',
  full_name: 'Client Contact',
  email: 'Client@example.com',
};

describe('completePortalSetup', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    verifyTokenMock.mockReset();
    markTokenAsUsedMock.mockReset();
    cleanupExpiredTokensMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    portalRoleFixture.initialRoleId = 'client-user-role';
    portalRoleFixture.roleWrites.length = 0;
    portalRoleFixture.resolverCalls.length = 0;
    portalRoleFixture.linkSyncs.length = 0;
  });

  it('returns a controlled duplicate-user result when invitation contact email is already used in the tenant', async () => {
    const harness = buildKnexHarness({
      existingContactUser: null,
      emailOwner: {
        user_id: 'internal-user-1',
        user_type: 'internal',
        contact_id: null,
        linked_contact_id: null,
      },
    });
    createTenantKnexMock.mockResolvedValue({
      knex: harness.knexMock,
      tenant: 'tenant-1',
    });
    verifyTokenMock.mockResolvedValue({
      valid: true,
      tenant: 'tenant-1',
      contact: contactPayload,
      invitation: {
        metadata: {
          entraPrelink: {
            provider: 'microsoft',
            providerAccountId: 'entra-object-1',
          },
        },
      },
    });

    const { completePortalSetup } = await import(
      '../../../../../packages/portal-shared/src/actions/portalInvitationActions'
    );
    const result = await completePortalSetup('token-1');

    expect(result).toEqual({
      success: false,
      error: 'An account already exists for this email address. Sign in instead, or reset your password from the sign-in page.',
      errorCode: 'PORTAL_USER_ALREADY_EXISTS',
    });
    expect(harness.transactionMock).not.toHaveBeenCalled();
    expect(harness.usersInsertMock).not.toHaveBeenCalled();
    expect(markTokenAsUsedMock).not.toHaveBeenCalled();
  });

  it('relinks a portal account orphaned by a contact delete and sets the new password', async () => {
    const harness = buildKnexHarness({
      existingContactUser: null,
      emailOwner: {
        user_id: 'orphan-user-1',
        user_type: 'client',
        // The contact this account pointed at was hard-deleted, so the left join
        // produced no contact row.
        contact_id: 'deleted-contact',
        username: 'client@example.com',
        linked_contact_id: null,
      },
    });
    harness.transactionMock.mockImplementation(async (callback: (trx: any) => Promise<unknown>) =>
      callback(harness.knexMock)
    );
    createTenantKnexMock.mockResolvedValue({
      knex: harness.knexMock,
      tenant: 'tenant-1',
    });
    markTokenAsUsedMock.mockResolvedValue(true);
    verifyTokenMock.mockResolvedValue({
      valid: true,
      tenant: 'tenant-1',
      contact: contactPayload,
      invitation: { metadata: {} },
    });

    const { completePortalSetup } = await import(
      '../../../../../packages/portal-shared/src/actions/portalInvitationActions'
    );
    const result = await completePortalSetup('token-1', 'ruby-slippers-1');

    expect(result).toMatchObject({
      success: true,
      userId: 'orphan-user-1',
      username: 'client@example.com',
    });
    expect(harness.usersInsertMock).not.toHaveBeenCalled();
    expect(harness.usersUpdateMock).toHaveBeenCalledWith(
      { user_id: 'orphan-user-1' },
      expect.objectContaining({ contact_id: 'contact-1' })
    );
    expect(harness.usersUpdateMock).toHaveBeenCalledWith(
      { user_id: 'orphan-user-1' },
      expect.objectContaining({ hashed_password: 'hashed:ruby-slippers-1', is_inactive: false })
    );
    expect(markTokenAsUsedMock).toHaveBeenCalledWith('token-1');
    // The relink moved users.contact_id without writing a role, so the flag of
    // the contact it now points at is re-derived from the roles the adopted
    // account already holds (alga-2026-0003347).
    expect(portalRoleFixture.linkSyncs).toEqual([
      { tenant: 'tenant-1', userId: 'orphan-user-1', previousContactId: null },
    ]);
  });

  it('assigns the role resolved from the contact pre-mark in the account transaction', async () => {
    const harness = buildKnexHarness({ existingContactUser: null, emailOwner: null, createdUserId: 'new-user-1' });
    harness.transactionMock.mockImplementation(async (callback: (trx: any) => Promise<unknown>) =>
      callback(harness.knexMock)
    );
    createTenantKnexMock.mockResolvedValue({ knex: harness.knexMock, tenant: 'tenant-1' });
    markTokenAsUsedMock.mockResolvedValue(true);
    verifyTokenMock.mockResolvedValue({
      valid: true,
      tenant: 'tenant-1',
      contact: contactPayload,
      invitation: { metadata: {} },
    });
    portalRoleFixture.initialRoleId = 'client-admin-role';

    const { completePortalSetup } = await import(
      '../../../../../packages/portal-shared/src/actions/portalInvitationActions'
    );
    const result = await completePortalSetup('token-1', 'ruby-slippers-2');

    expect(result).toMatchObject({ success: true, userId: 'new-user-1' });
    expect(portalRoleFixture.resolverCalls).toEqual([{ tenant: 'tenant-1', contactId: 'contact-1' }]);
    expect(portalRoleFixture.roleWrites).toEqual([
      { tenant: 'tenant-1', userId: 'new-user-1', roleIds: ['client-admin-role'] },
    ]);
  });

  it('fails the setup when no portal role can be resolved, instead of creating a role-less account', async () => {
    const harness = buildKnexHarness({ existingContactUser: null, emailOwner: null, createdUserId: 'new-user-2' });
    // A real transaction rolls the user insert back when the callback throws;
    // here the rejection is what proves the failure is not swallowed.
    harness.transactionMock.mockImplementation(async (callback: (trx: any) => Promise<unknown>) =>
      callback(harness.knexMock)
    );
    createTenantKnexMock.mockResolvedValue({ knex: harness.knexMock, tenant: 'tenant-1' });
    markTokenAsUsedMock.mockResolvedValue(true);
    verifyTokenMock.mockResolvedValue({
      valid: true,
      tenant: 'tenant-1',
      contact: contactPayload,
      invitation: { metadata: {} },
    });
    portalRoleFixture.initialRoleId = null;

    const { completePortalSetup } = await import(
      '../../../../../packages/portal-shared/src/actions/portalInvitationActions'
    );
    const result = await completePortalSetup('token-1', 'ruby-slippers-3');

    expect(result).toMatchObject({ success: false, errorCode: 'CREATE_USER_FAILED' });
    expect(portalRoleFixture.roleWrites).toEqual([]);
    // The account creation was rolled back with the failure, and the
    // invitation token is still unused, so the link can be used again.
    expect(markTokenAsUsedMock).not.toHaveBeenCalled();
  });
});
