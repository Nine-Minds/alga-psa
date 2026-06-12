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
  UserPreferences: {
    upsert: vi.fn(),
  },
}));

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

function buildKnexHarness(params: {
  existingContactUser?: { user_id: string } | null;
  existingEmailUser?: { user_id: string } | null;
}) {
  const transactionMock = vi.fn();
  const usersInsertMock = vi.fn();

  const knexMock: any = vi.fn((table: string) => {
    if (table === 'users') {
      return {
        where: vi.fn((conditions: Record<string, unknown>) => {
          if (conditions.contact_id) {
            return {
              first: vi.fn(async () => params.existingContactUser ?? undefined),
            };
          }

          return {
            andWhereRaw: vi.fn(() => ({
              first: vi.fn(async () => params.existingEmailUser ?? undefined),
            })),
            first: vi.fn(async () => undefined),
          };
        }),
        insert: usersInsertMock,
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });
  knexMock.transaction = transactionMock;

  return {
    knexMock,
    transactionMock,
    usersInsertMock,
  };
}

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
      existingEmailUser: { user_id: 'internal-user-1' },
    });
    createTenantKnexMock.mockResolvedValue({
      knex: harness.knexMock,
      tenant: 'tenant-1',
    });
    verifyTokenMock.mockResolvedValue({
      valid: true,
      tenant: 'tenant-1',
      contact: {
        contact_name_id: 'contact-1',
        full_name: 'Client Contact',
        email: 'Client@example.com',
      },
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
      error: 'A portal user already exists for this contact or email address',
      errorCode: 'PORTAL_USER_ALREADY_EXISTS',
    });
    expect(harness.transactionMock).not.toHaveBeenCalled();
    expect(harness.usersInsertMock).not.toHaveBeenCalled();
    expect(markTokenAsUsedMock).not.toHaveBeenCalled();
  });
});
