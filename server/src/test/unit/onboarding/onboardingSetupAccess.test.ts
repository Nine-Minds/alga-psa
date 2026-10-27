import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every internal user was sent into workspace setup, and its server actions
 * checked no permission: a technician could create users, rewrite ticketing
 * defaults and mark the tenant onboarded.
 */
const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  createClient: vi.fn(),
  addUser: vi.fn(),
  findUsersByEmailAndType: vi.fn(async () => [] as Array<{ user_id: string }>),
  userUpdates: [] as unknown[],
}));

function queryFor(table: string) {
  const query: any = {
    where: () => query, whereNull: () => query, forUpdate: () => query, count: () => query, insert: async () => undefined,
    update: async (payload: unknown) => { if (table === 'users') mocks.userUpdates.push(payload); },
    select: async () => table === 'roles' ? [{ role_id: 'role-admin', role_name: 'Admin' }] : [],
    first: async () => undefined,
  };
  return query;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'now' } } }),
  tenantDb: () => ({ table: queryFor }),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: unknown) => handler, hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/tenancy/server', () => ({ persistTenantOnboardingProgress: vi.fn() }));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  saveTenantOnboardingProgress: vi.fn(), updateTenantOnboardingStatus: vi.fn(async () => ({ success: true })),
}));
vi.mock('@alga-psa/users/actions/user-actions/userActions', () => ({ addUser: mocks.addUser }));
vi.mock('@alga-psa/db/models/user', () => ({ default: { findUsersByEmailAndType: mocks.findUsersByEmailAndType } }));
vi.mock('@alga-psa/clients/actions/clientActions', () => ({ createClient: mocks.createClient }));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({ createClientContact: vi.fn() }));
vi.mock('../../../../../packages/licensing/src/lib/get-license-usage', () => ({
  getLicenseUsage: vi.fn(async () => ({ limit: null, used: 0 })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import * as actions from '../../../../../packages/onboarding/src/actions/onboarding-actions/onboardingActions';

const user = { user_id: 'technician', user_type: 'internal' } as any;
const clientAdmin = { user_id: 'client-admin', user_type: 'client', contact_id: 'contact-1' } as any;
const servicePrincipal = { user_id: 'svc', user_type: 'service' } as any;
const context = { tenant: 'tenant-1' } as any;
const member = { firstName: 'Tom', lastName: 'Tech', email: 'tom@example.test', role: 'Technician', password: 'NineMinds1234!' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockResolvedValue(false);
  mocks.userUpdates.length = 0;
});

const SETUP_ACTIONS: Array<[string, (caller: any) => Promise<unknown>]> = [
  ['saveClientInfo', (caller: any) => actions.saveClientInfo(caller, context, { firstName: 'A', lastName: 'B', tenantName: 'T', email: 'a@example.test' } as any)],
  ['addSingleTeamMember', (caller: any) => actions.addSingleTeamMember(caller, context, member)],
  ['addTeamMembers', (caller: any) => actions.addTeamMembers(caller, context, [member])],
  ['createClient', (caller: any) => actions.createClient(caller, context, { clientName: 'C' } as any)],
  ['addClientContact', (caller: any) => actions.addClientContact(caller, context, { contactName: 'C', clientId: 'c' } as any)],
  ['setupBilling', (caller: any) => actions.setupBilling(caller, context, { serviceName: 'S' } as any)],
  ['configureTicketing', (caller: any) => actions.configureTicketing(caller, context, { boardName: 'B' } as any)],
  ['saveOnboardingStepPosition', (caller: any) => actions.saveOnboardingStepPosition(caller, context, 2)],
  ['completeOnboarding', (caller: any) => actions.completeOnboarding(caller, context)],
];

describe('workspace setup access', () => {
  it('reports setup access from the settings:update permission', async () => {
    await expect(actions.getWorkspaceSetupAccess(user, context)).resolves.toEqual({ canRun: false });
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'settings', 'update');
    mocks.hasPermission.mockResolvedValue(true);
    await expect(actions.getWorkspaceSetupAccess(user, context)).resolves.toEqual({ canRun: true });
  });

  it.each(SETUP_ACTIONS)('%s refuses a user who cannot run workspace setup', async (_name, call) => {
    await expect(call(user)).resolves.toEqual({ success: false, error: 'Only an administrator can complete workspace setup.' });
    expect(mocks.addUser).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe('workspace setup refuses client-portal principals', () => {
  // client Admin holds settings:update and user:create in its own portal, so
  // the permission check alone would let it through.
  beforeEach(() => mocks.hasPermission.mockResolvedValue(true));

  it('reports no setup access for a service principal', async () => {
    await expect(actions.getWorkspaceSetupAccess(servicePrincipal, context)).resolves.toEqual({ canRun: false });
  });

  it('reports no setup access for a client admin', async () => {
    await expect(actions.getWorkspaceSetupAccess(clientAdmin, context)).resolves.toEqual({ canRun: false });
  });

  it.each(SETUP_ACTIONS)('%s refuses an authenticated client admin', async (_name, call) => {
    await expect(call(clientAdmin)).resolves.toEqual({ success: false, error: 'Only an administrator can complete workspace setup.' });
  });

  // A service principal is an MSP-side type that rbac would grant msp
  // permissions to, so only the user-type check keeps it out of setup.
  it.each(SETUP_ACTIONS)('%s refuses a service principal', async (_name, call) => {
    mocks.addUser.mockResolvedValue({ success: true, user: { user_id: 'new' } });
    await expect(call(servicePrincipal)).resolves.toEqual({ success: false, error: 'Only an administrator can complete workspace setup.' });
    expect(mocks.addUser).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('never creates an internal user for a client admin', async () => {
    mocks.addUser.mockResolvedValue({ success: true, user: { user_id: 'new' } });
    await actions.addSingleTeamMember(clientAdmin, context, { ...member, role: 'Admin' });
    await actions.addTeamMembers(clientAdmin, context, [{ ...member, role: 'Admin' }]);
    expect(mocks.addUser).not.toHaveBeenCalled();
  });
});

describe('workspace setup sign-in email', () => {
  const admin = { user_id: 'admin', user_type: 'internal', email: 'admin@example.test' } as any;
  const info = (email: string) => ({ firstName: 'A', lastName: 'B', tenantName: 'T', email }) as any;
  beforeEach(() => mocks.hasPermission.mockResolvedValue(true));

  it('refuses an email that belongs to another internal account', async () => {
    mocks.findUsersByEmailAndType.mockResolvedValueOnce([{ user_id: 'someone-else' }]);
    const result = await actions.saveClientInfo(admin, context, info('Taken@Example.test'));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('already used by another account') });
    expect(mocks.findUsersByEmailAndType).toHaveBeenCalledWith('taken@example.test', 'internal');
    expect(mocks.userUpdates).toEqual([]);
  });

  it('validates and stores the same trimmed, lower-cased address', async () => {
    await expect(actions.saveClientInfo(admin, context, info('  New.Admin@Example.test  '))).resolves.toEqual({ success: true });
    expect(mocks.findUsersByEmailAndType).toHaveBeenCalledWith('new.admin@example.test', 'internal');
    expect(mocks.userUpdates).toEqual([expect.objectContaining({ email: 'new.admin@example.test' })]);
  });

  it('stores the caller\'s own address trimmed even when it is otherwise unchanged', async () => {
    await expect(actions.saveClientInfo(admin, context, info('  Admin@Example.test '))).resolves.toEqual({ success: true });
    expect(mocks.findUsersByEmailAndType).not.toHaveBeenCalled();
    expect(mocks.userUpdates).toEqual([expect.objectContaining({ email: 'admin@example.test' })]);
  });

  it('refuses an invalid email', async () => {
    await expect(actions.saveClientInfo(admin, context, info('not-an-email'))).resolves.toMatchObject({ success: false });
    expect(mocks.userUpdates).toEqual([]);
  });

  it('ignores the caller\'s own account when checking uniqueness', async () => {
    mocks.findUsersByEmailAndType.mockResolvedValueOnce([{ user_id: 'admin' }]);
    await expect(actions.saveClientInfo(admin, context, info('new@example.test'))).resolves.toEqual({ success: true });
  });

  it('does not re-check an unchanged email', async () => {
    await actions.saveClientInfo(admin, context, info('ADMIN@example.test'));
    expect(mocks.findUsersByEmailAndType).not.toHaveBeenCalled();
  });
});
