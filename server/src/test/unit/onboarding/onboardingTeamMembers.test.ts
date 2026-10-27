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

const user = { user_id: 'admin', user_type: 'internal' } as any;
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

  it('reports each member the seat limit refused, and only those, as skipped for the limit', async () => {
    mocks.addUser
      .mockResolvedValueOnce({ success: true, user: { user_id: 'one' } })
      .mockResolvedValueOnce({ success: false, code: 'LICENSE_LIMIT_REACHED', error: 'Limit reached.' })
      .mockResolvedValueOnce({ success: false, code: 'EMAIL_ALREADY_EXISTS', error: 'Email in use.' })
      .mockResolvedValueOnce({ success: false, code: 'LICENSE_LIMIT_REACHED', error: 'Limit reached.' });
    const result = await addTeamMembers(user, context, [technician,
      { ...technician, email: 'two@example.test' }, { ...technician, email: 'three@example.test' },
      { ...technician, email: 'four@example.test' }, { ...technician, email: 'five@example.test', password: undefined }]);
    expect(result.success).toBe(false);
    expect(result.data.created).toEqual(['tom@example.test']);
    expect(result.data.notCreated).toEqual([
      { email: 'two@example.test', reason: 'limit', error: 'Limit reached.' },
      { email: 'three@example.test', reason: 'exists', error: 'Email in use.' },
      { email: 'four@example.test', reason: 'limit', error: 'Limit reached.' },
      { email: 'five@example.test', reason: 'failed', error: expect.stringMatching(/temporary password/) },
    ]);
    expect(result.error).toMatch(/^4 team member\(s\) were not created/);
    // The member without a password never reaches addUser; every other one does.
    expect(mocks.addUser).toHaveBeenCalledTimes(4);
  });

  it('does not report a mixed batch as a success', async () => {
    mocks.addUser
      .mockResolvedValueOnce({ success: true, user: { user_id: 'one' } })
      .mockResolvedValueOnce({ success: false, code: 'USER_CREATE_FAILED', error: 'Could not create user.' });
    const result = await addTeamMembers(user, context, [technician, { ...technician, email: 'two@example.test' }]);
    expect(result).toMatchObject({ success: false, data: { created: ['tom@example.test'],
      notCreated: [{ email: 'two@example.test', reason: 'failed', error: 'Could not create user.' }] } });
  });

  it('reports a fully created batch as a success', async () => {
    const result = await addTeamMembers(user, context, [technician, { ...technician, email: 'two@example.test' }]);
    expect(result).toMatchObject({ success: true, data: { created: ['tom@example.test', 'two@example.test'], notCreated: [] } });
  });

  it('never stores temporary passwords in the onboarding progress', async () => {
    await addTeamMembers(user, context, [technician]);
    expect(JSON.stringify(mocks.persist.mock.calls)).not.toContain('NineMinds1234!');
    expect(mocks.persist).toHaveBeenCalledWith({}, 'tenant-1', { teamMembers: [
      { firstName: 'Tom', lastName: 'Tech', email: 'tom@example.test', role: 'Technician' }] });
  });
});

describe('wizard seat usage', () => {
  it('counts pending invitations as reserved seats on top of active users', async () => {
    mocks.pendingInvitations = 1;
    await expect(getOnboardingLicenseUsage(user, context)).resolves.toEqual({ success: true, data: { limit: 3, used: 2 } });
  });

  it('counts only active users when nothing is pending', async () => {
    mocks.pendingInvitations = 0;
    await expect(getOnboardingLicenseUsage(user, context)).resolves.toEqual({ success: true, data: { limit: 3, used: 1 } });
  });

  it('reports the same count in the licenseStatus returned after a save', async () => {
    mocks.pendingInvitations = 1;
    mocks.addUser.mockResolvedValue({ success: true, user: { user_id: 'one' } });
    await expect(addSingleTeamMember(user, context, technician)).resolves.toMatchObject({
      success: true, data: { licenseStatus: { current: 2, limit: 3 } } });
    await expect(addTeamMembers(user, context, [technician])).resolves.toMatchObject({
      success: true, data: { licenseStatus: { current: 2, limit: 3 } } });
  });
});
