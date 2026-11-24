import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const verifyTokenMock = vi.fn();
const markTokenAsUsedMock = vi.fn();
const cleanupExpiredTokensMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
  getTenantSlugForTenant: vi.fn(),
  // The action reaches tables through tenantDb; the harness below still models
  // the raw knex surface, so scope resolution is a pass-through here.
  tenantDb: (conn: any) => ({
    table: (tableName: string) => conn(tableName),
    unscoped: (tableName: string) => conn(tableName),
    tenantJoin: (query: any) => query,
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
}) {
  const transactionMock = vi.fn();
  const usersInsertMock = vi.fn();
  const usersUpdateMock = vi.fn(async () => 1);

  const knexMock: any = vi.fn((table: string) => {
    if (table === 'contacts') {
      return {
        where: vi.fn(() => ({
          first: vi.fn(async () => ({ contact_kind: 'person' })),
        })),
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
  });
});
