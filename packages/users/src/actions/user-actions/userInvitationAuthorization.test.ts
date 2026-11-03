import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  actorRoles: vi.fn(),
  invitationRows: [] as Array<Record<string, unknown>>,
  delivered: [] as Array<Record<string, unknown>>,
  targetRoles: [
    { role_id: 'admin-role', role_name: 'Admin', msp: true },
    { role_id: 'eligible-role', role_name: 'Ticket Reader', msp: true },
  ],
  targetPermissions: [
    { role_id: 'admin-role', resource: 'ticket', action: 'read', msp: true },
    { role_id: 'admin-role', resource: 'system', action: 'admin', msp: true },
    { role_id: 'eligible-role', resource: 'ticket', action: 'read', msp: true },
  ],
}));

function tableQuery(name: string) {
  const query: any = {
    where: () => query,
    whereNull: () => query,
    whereNot: () => query,
    whereIn: (_column: string, ids: string[]) => {
      query.ids = ids;
      return query;
    },
    select: () => {
      if (name === 'roles') return Promise.resolve(fixture.targetRoles.filter((role) => query.ids?.includes(role.role_id)));
      if (name === 'role_permissions as rp') return Promise.resolve(fixture.targetPermissions.filter((row) => query.ids?.includes(row.role_id)));
      return query;
    },
    first: async () => {
      if (name === 'roles') return fixture.targetRoles.find((role) => role.role_id === query.criteria?.role_id);
      if (name === 'users') return undefined;
      if (name === 'user_invitations') return undefined;
      if (name === 'tenant_companies') return { client_name: 'Example MSP' };
      return undefined;
    },
    insert: async (row: Record<string, unknown>) => {
      fixture.invitationRows.push(row);
      return [];
    },
    update: async () => 0,
    count: async () => [{ count: '0' }],
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
      if (name === 'role_permissions as rp') {
        return Promise.resolve(fixture.targetPermissions.filter((row) => query.ids?.includes(row.role_id))).then(resolve, reject);
      }
      return Promise.resolve([]).then(resolve, reject);
    },
  };
  query.where = (criteria: Record<string, unknown>) => {
    query.criteria = criteria;
    return query;
  };
  return query;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({
    knex: {
      fn: { now: () => new Date() },
      transaction: (fn: (trx: any) => unknown) => fn({ fn: { now: () => new Date() }, raw: vi.fn() }),
    },
  }),
  tenantDb: () => ({
    table: (name: string) => tableQuery(name),
    tenantJoin: () => undefined,
  }),
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
  runAsSystem: (_reason: string, fn: () => unknown) => fn(),
  createSystemContext: (tenant: string) => ({ tenant }),
}));
vi.mock('@alga-psa/db/models/user', () => ({ default: { getUserRolesWithPermissions: fixture.actorRoles } }));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true, getInitializationError: async () => undefined }) },
  getSystemEmailService: vi.fn(),
  sendTeamInvitationEmail: async (data: Record<string, unknown>) => { fixture.delivered.push(data); },
}));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: fixture.hasPermission }));
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
    createInvitationWithTransaction: async (data: Record<string, unknown>) => {
      fixture.invitationRows.push(data);
      return { success: true, invitationId: 'invitation-1', token: 'token-1' };
    },
  },
}));
vi.mock('../../lib/internalUserLicenseGuard', () => ({
  checkInternalUserLicenseLimit: async () => ({ ok: true }),
  countPendingInvitationSeats: async () => 0,
  isInternalUserLicenseLimitRejected: () => false,
  lockInternalUserSeats: async () => undefined,
}));
vi.mock('@alga-psa/licensing', () => ({
  assertCoManagedSeatAdmission: vi.fn(),
  CoManagedAdmissionError: class CoManagedAdmissionError extends Error {},
}));
vi.mock('../../lib/coManagedInvitationCapability', () => ({ isCoManagedInvitationServed: vi.fn() }));

import { sendUserInvitation } from './userInvitationActions';

describe('sendUserInvitation authorization boundary', () => {
  beforeEach(() => {
    fixture.hasPermission.mockReset();
    fixture.actorRoles.mockReset();
    fixture.invitationRows.length = 0;
    fixture.delivered.length = 0;
    fixture.hasPermission.mockResolvedValue(true);
    fixture.actorRoles.mockResolvedValue([{
      msp: true,
      permissions: [
        { resource: 'user', action: 'invite', msp: true },
        { resource: 'user', action: 'create', msp: true },
        { resource: 'user', action: 'update', msp: true },
        { resource: 'ticket', action: 'read', msp: true },
      ],
    }]);
    process.env.NEXT_PUBLIC_BASE_URL = 'https://example.test';
  });

  it('returns an actionable permission denial and creates or delivers nothing for Admin', async () => {
    const result = await sendUserInvitation({
      email: 'attacker@example.test', firstName: 'Attacker', lastName: 'Account', roleId: 'admin-role',
    } as any);

    expect(result).toMatchObject({ success: false, errorCode: 'PERMISSION_DENIED_INVITE' });
    expect(result.error).toMatch(/Cannot assign an MSP role/);
    expect(fixture.invitationRows).toHaveLength(0);
    expect(fixture.delivered).toHaveLength(0);
  });

  it('persists and delivers an invitation for an eligible role', async () => {
    const result = await sendUserInvitation({
      email: 'eligible@example.test', firstName: 'Eligible', lastName: 'User', roleId: 'eligible-role',
    } as any);

    expect(result).toMatchObject({ success: true, invitationId: 'invitation-1' });
    expect(fixture.invitationRows).toHaveLength(1);
    expect(fixture.invitationRows[0]).toMatchObject({ roleId: 'eligible-role' });
    expect(fixture.delivered).toHaveLength(1);
    expect(fixture.delivered[0]).toMatchObject({ email: 'eligible@example.test' });
  });
});
