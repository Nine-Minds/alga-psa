import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wizard's team step used to create accounts with its own copy of addUser:
 * no seat admission, a fixed default password when none was given, and a
 * case-folded role lookup that missed and fell back to the first role (Admin).
 * It now goes through addUser, the same path as Settings → Users.
 */
const mocks = vi.hoisted(() => ({
  addUser: vi.fn(),
  persist: vi.fn(async () => undefined),
  pendingInvitations: 0,
}));

function queryFor(table: string) {
  const query: any = {
    where: () => query, whereNull: () => query, count: () => query,
    select: async () => table === 'roles'
      ? [{ role_id: 'role-admin', role_name: 'Admin' }, { role_id: 'role-tech', role_name: 'Technician' }] : [],
    first: async () => table === 'user_invitations' ? { count: String(mocks.pendingInvitations) } : undefined,
  };
  return query;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'now' } } }),
  tenantDb: () => ({ table: queryFor }),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: unknown) => handler, hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/tenancy/server', () => ({ persistTenantOnboardingProgress: mocks.persist }));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  saveTenantOnboardingProgress: vi.fn(), updateTenantOnboardingStatus: vi.fn(),
}));
vi.mock('@alga-psa/users/actions/user-actions/userActions', () => ({ addUser: mocks.addUser }));
vi.mock('@alga-psa/clients/actions/clientActions', () => ({ createClient: vi.fn() }));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({ createClientContact: vi.fn() }));
vi.mock('../../../../../packages/licensing/src/lib/get-license-usage', () => ({
  getLicenseUsage: vi.fn(async () => ({ limit: 3, used: 1 })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { addSingleTeamMember, addTeamMembers, getOnboardingLicenseUsage }
  from '../../../../../packages/onboarding/src/actions/onboarding-actions/onboardingActions';

const user = { user_id: 'admin' } as any;
const context = { tenant: 'tenant-1' } as any;
const technician = { firstName: 'Tom', lastName: 'Tech', email: 'tom@example.test', role: 'Technician', password: 'NineMinds1234!' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pendingInvitations = 0;
  mocks.addUser.mockResolvedValue({ success: true, user: { user_id: 'new' } });
});

describe('wizard team member creation', () => {
  it('creates the member through addUser with the chosen role and password', async () => {
    await expect(addSingleTeamMember(user, context, technician)).resolves.toMatchObject({ success: true });
    expect(mocks.addUser).toHaveBeenCalledWith({ firstName: 'Tom', lastName: 'Tech', email: 'tom@example.test',
      password: 'NineMinds1234!', roleId: 'role-tech', userType: 'internal' });
  });

  it('refuses an unknown role instead of falling back to Admin', async () => {
    const result = await addSingleTeamMember(user, context, { ...technician, role: 'technician-typo' });
    expect(result).toMatchObject({ success: false });
    expect(mocks.addUser).not.toHaveBeenCalled();
  });

  it('refuses a member without a password instead of using a default one', async () => {
    const result = await addSingleTeamMember(user, context, { ...technician, password: undefined });
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/temporary password|email invite/);
    expect(mocks.addUser).not.toHaveBeenCalled();
  });

  it('reports the seat limit addUser enforces', async () => {
    mocks.addUser.mockResolvedValue({ success: false, code: 'LICENSE_LIMIT_REACHED', error: 'All seats are in use.' });
    await expect(addSingleTeamMember(user, context, technician)).resolves.toEqual({ success: false, error: 'All seats are in use.' });
  });

  it('reports an email addUser finds already in use', async () => {
    mocks.addUser.mockResolvedValue({ success: false, code: 'EMAIL_ALREADY_EXISTS', error: 'A user with this email already exists.' });
    await expect(addSingleTeamMember(user, context, technician)).resolves.toEqual({ success: false, error: 'A user with this email already exists.' });
  });

  it('stops at the seat limit and lists the members that did not fit', async () => {
    mocks.addUser
      .mockResolvedValueOnce({ success: true, user: { user_id: 'one' } })
      .mockResolvedValueOnce({ success: false, code: 'LICENSE_LIMIT_REACHED', error: 'Limit reached.' });
    const result = await addTeamMembers(user, context, [technician,
      { ...technician, email: 'two@example.test' }, { ...technician, email: 'three@example.test' }]);
    expect(result).toMatchObject({ success: true, data: { created: ['tom@example.test'],
      skippedDueToLimit: ['two@example.test', 'three@example.test'] } });
    expect(mocks.addUser).toHaveBeenCalledTimes(2);
  });

  it('never stores temporary passwords in the onboarding progress', async () => {
    await addTeamMembers(user, context, [technician]);
    expect(JSON.stringify(mocks.persist.mock.calls)).not.toContain('NineMinds1234!');
    expect(mocks.persist).toHaveBeenCalledWith({}, 'tenant-1', { teamMembers: [
      { firstName: 'Tom', lastName: 'Tech', email: 'tom@example.test', role: 'Technician' }] });
  });
});

describe('wizard seat usage', () => {
  it('counts seats as addUser admits them, so the counter and the save agree', async () => {
    mocks.pendingInvitations = 1;
    await expect(getOnboardingLicenseUsage(user, context)).resolves.toEqual({ success: true, data: { limit: 3, used: 1 } });
  });
});
