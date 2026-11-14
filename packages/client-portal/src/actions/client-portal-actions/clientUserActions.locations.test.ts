import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T078: where someone works is an MSP-managed fact. The portal write path refuses both fields
 * outright rather than dropping them through the field allowlist, so a portal caller can never
 * believe it edited them.
 */
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const assertCanManageClientUserSpy = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'portal-user', tenant: 'tenant-1', user_type: 'client' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...(args as [])),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table) }),
  getTenantSlugForTenant: vi.fn(async () => 'tenant-slug'),
}));

vi.mock('@alga-psa/shared/lib/contacts/contactEvents', () => ({ trackContactUpdates: vi.fn() }));
vi.mock('@alga-psa/shared/models/contactLocation', () => ({ getContactLocations: vi.fn(async () => []) }));
vi.mock('@alga-psa/core/encryption', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/storage', () => ({ uploadEntityImage: vi.fn(), deleteEntityImage: vi.fn() }));
vi.mock('@alga-psa/auth/actions/policyActions', () => ({
  getRoles: vi.fn(async () => []),
  assignRoleToUser: vi.fn(),
  removeRoleFromUser: vi.fn(),
}));
vi.mock('@shared/models/userModel', () => ({
  createPortalUserInDB: vi.fn(),
  getClientPortalRoles: vi.fn(async () => []),
}));
vi.mock('@shared/models/contactModel', () => ({ assertValidContactManager: vi.fn() }));
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({ collectReportContactIds: vi.fn(async () => []) }));

describe('updateClientUser location fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) => {
      assertCanManageClientUserSpy();
      return callback({} as any);
    });
  });

  it('rejects a portal write that carries locations', async () => {
    const { updateClientUser } = await import('./clientUserActions');

    const result = await updateClientUser('user-1', { locations: [] } as any);

    expect(result).toEqual({ actionError: 'Locations and work arrangement cannot be changed from the client portal' });
    // Refused before the write even opens, so nothing can have been persisted.
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects a portal write that carries work_arrangement, even when it is null', async () => {
    const { updateClientUser } = await import('./clientUserActions');

    const result = await updateClientUser('user-1', { work_arrangement: null } as any);

    expect(result).toEqual({ actionError: 'Locations and work arrangement cannot be changed from the client portal' });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
});
