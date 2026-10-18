import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Internal users sign in with an email and no tenant, so an internal email must
 * identify one account across every tenant. Team invitations created a second
 * internal account for an email already used elsewhere — the provisioned
 * co-managed administrator case — after which sign-in resolved to either
 * account and the existing user was locked out.
 */
const mocks = vi.hoisted(() => ({
  findUsersByEmailAndType: vi.fn(),
  verifyToken: vi.fn(),
  createFromInvitation: vi.fn(),
  createInvitationWithTransaction: vi.fn(),
  first: vi.fn(),
}));

vi.mock('@alga-psa/db/models/user', () => ({ default: { findUsersByEmailAndType: mocks.findUsersByEmailAndType } }));
vi.mock('@alga-psa/db', () => {
  const builder = () => {
    const query: any = { where: () => query, whereNull: () => query, whereNot: () => query, count: () => query, first: mocks.first };
    return query;
  };
  return {
    createTenantKnex: async () => ({ knex: { transaction: async (fn: any) => fn({}) }, tenant: 'tenant-1' }),
    tenantDb: () => ({ table: builder }),
    runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
    runAsSystem: async (_reason: string, fn: () => unknown) => fn(),
    createSystemContext: () => ({}),
    UserPreferences: { upsert: async () => undefined },
  };
});
vi.mock('../../services/UserInvitationService', () => ({
  UserInvitationService: { verifyToken: mocks.verifyToken, createInvitationWithTransaction: mocks.createInvitationWithTransaction,
    cleanupExpiredTokens: async () => undefined },
}));
vi.mock('../../services/UserService', () => ({
  UserService: class { createFromInvitation = mocks.createFromInvitation; },
}));
vi.mock('../../lib/internalUserLicenseGuard', () => ({
  checkInternalUserLicenseLimit: async () => ({ ok: true }),
  isInternalUserLicenseLimitRejected: () => false,
}));
vi.mock('@alga-psa/email', () => ({
  getSystemEmailService: async () => ({ isConfigured: async () => true }),
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true }) },
  sendTeamInvitationEmail: vi.fn(),
}));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) => (...args: any[]) =>
    fn({ user_id: 'inviter', first_name: 'In', last_name: 'Viter', username: 'inviter' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/validation', () => ({ validatePassword: () => null }));

import { completeUserInvitationSetup, sendUserInvitation } from './userInvitationActions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyToken.mockResolvedValue({ valid: true, tenant: 'tenant-1', invitee: { email: 'admin@example.test' }, invitation: { role_id: 'role-1' } });
  // No same-tenant user; the invitation role exists.
  mocks.first.mockImplementation(async (...fields: string[]) => (fields.length ? undefined : { role_id: 'role-1', role_name: 'Admin' }));
  mocks.createFromInvitation.mockResolvedValue({ user_id: 'new-user', username: 'admin@example.test' });
});

describe('team invitation acceptance', () => {
  it('refuses an email that already identifies an internal user in another tenant', async () => {
    mocks.first.mockResolvedValueOnce(undefined); // no same-tenant user
    mocks.findUsersByEmailAndType.mockResolvedValue([{ user_id: 'elsewhere', tenant: 'tenant-2' }]);

    const result = await completeUserInvitationSetup('token', 'NineMinds1234!');

    expect(result).toMatchObject({ success: false, errorCode: 'EMAIL_IN_USE_ELSEWHERE', messageKey: 'teamSetup.errors.emailInUseElsewhere' });
    expect(mocks.findUsersByEmailAndType).toHaveBeenCalledWith('admin@example.test', 'internal');
    expect(mocks.createFromInvitation).not.toHaveBeenCalled();
  });

  it('creates the account when no other tenant uses the email', async () => {
    mocks.first.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ role_id: 'role-1' });
    mocks.findUsersByEmailAndType.mockResolvedValue([]);

    const result = await completeUserInvitationSetup('token', 'NineMinds1234!');

    expect(mocks.createFromInvitation).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, username: 'admin@example.test' });
  });
});

describe('team invitation send', () => {
  it('refuses before creating an invitation when another tenant has an internal user with the email', async () => {
    mocks.first
      .mockResolvedValueOnce({ role_id: 'role-1', role_name: 'Technician' }) // role
      .mockResolvedValueOnce(undefined); // no same-tenant user
    mocks.findUsersByEmailAndType.mockResolvedValue([{ user_id: 'elsewhere', tenant: 'tenant-2' }]);

    const result = await sendUserInvitation({ email: 'Admin@Example.test', firstName: 'A', lastName: 'B', roleId: 'role-1' });

    expect(result).toMatchObject({ success: false, errorCode: 'EMAIL_ALREADY_EXISTS' });
    expect(mocks.findUsersByEmailAndType).toHaveBeenCalledWith('admin@example.test', 'internal');
    expect(mocks.createInvitationWithTransaction).not.toHaveBeenCalled();
  });
});
