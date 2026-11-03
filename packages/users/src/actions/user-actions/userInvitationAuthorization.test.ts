import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  createTenantKnex: vi.fn(),
  authorizeRole: vi.fn(),
  createInvitation: vi.fn(),
  sendInvitation: vi.fn(),
  invitationCreateCalls: 0,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: (_db: unknown, _tenant: string) => ({
    table: (name: string) => ({
      where: () => ({
        first: async () => name === 'roles' ? { role_id: 'admin-role', role_name: 'Admin', msp: true } : undefined,
      }),
    }),
  }),
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
  runAsSystem: (_reason: string, fn: () => unknown) => fn(),
  createSystemContext: (tenant: string) => ({ tenant }),
}));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ isConfigured: vi.fn(), getInitializationError: vi.fn() }) },
  getSystemEmailService: vi.fn(),
  sendTeamInvitationEmail: mocks.sendInvitation,
}));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: any[]) => fn(
    { user_id: 'project-manager', user_type: 'internal', username: 'pm@example.test' },
    { tenant: 'tenant-1' },
    ...args,
  ),
}));
vi.mock('@alga-psa/core', () => ({ isValidEmail: (email: string) => email.includes('@') }));
vi.mock('@alga-psa/validation', () => ({ validatePassword: () => undefined }));
vi.mock('../../services/UserInvitationService', () => ({
  UserInvitationService: {
    createInvitationWithTransaction: (...args: unknown[]) => {
      mocks.invitationCreateCalls += 1;
      return mocks.createInvitation(...args);
    },
  },
}));
vi.mock('../../lib/internalUserLicenseGuard', () => ({
  checkInternalUserLicenseLimit: vi.fn(),
  countPendingInvitationSeats: vi.fn(),
  isInternalUserLicenseLimitRejected: vi.fn(),
  lockInternalUserSeats: vi.fn(),
}));
vi.mock('@alga-psa/licensing', () => ({
  assertCoManagedSeatAdmission: vi.fn(),
  CoManagedAdmissionError: class CoManagedAdmissionError extends Error {},
}));
vi.mock('../../lib/coManagedInvitationCapability', () => ({ isCoManagedInvitationServed: vi.fn() }));
vi.mock('../../lib/roleGrantAuthorization', () => ({
  assertMspRoleGrantsWithinActorPermissions: mocks.authorizeRole,
}));

import { sendUserInvitation } from './userInvitationActions';

describe('sendUserInvitation authorization boundary', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReset();
    mocks.createTenantKnex.mockReset();
    mocks.authorizeRole.mockReset();
    mocks.createInvitation.mockReset();
    mocks.sendInvitation.mockReset();
    mocks.invitationCreateCalls = 0;
    mocks.hasPermission.mockResolvedValue(true);
    mocks.createTenantKnex.mockResolvedValue({ knex: { transaction: vi.fn() } });
    mocks.authorizeRole.mockRejectedValue(new Error('Permission denied: Cannot assign an MSP role with permissions you do not hold'));
  });

  it('rejects an Admin role before creating or delivering the invitation', async () => {
    const result = await sendUserInvitation({
      email: 'attacker@example.test',
      firstName: 'Attacker',
      lastName: 'Account',
      roleId: 'admin-role',
    } as any);

    expect(result.success).toBe(false);
    expect(mocks.authorizeRole).toHaveBeenCalledWith('project-manager', 'tenant-1', expect.anything(), ['admin-role']);
    expect(mocks.invitationCreateCalls).toBe(0);
    expect(mocks.sendInvitation).not.toHaveBeenCalled();
  });

  it('rejects an inviter without account creation authority before role lookup or persistence', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, _resource: string, action: string) => action === 'invite');

    const result = await sendUserInvitation({
      email: 'attacker@example.test',
      firstName: 'Attacker',
      lastName: 'Account',
      roleId: 'admin-role',
    } as any);

    expect(result).toMatchObject({ success: false, errorCode: 'PERMISSION_DENIED_INVITE' });
    expect(mocks.authorizeRole).not.toHaveBeenCalled();
    expect(mocks.invitationCreateCalls).toBe(0);
    expect(mocks.sendInvitation).not.toHaveBeenCalled();
  });
});
