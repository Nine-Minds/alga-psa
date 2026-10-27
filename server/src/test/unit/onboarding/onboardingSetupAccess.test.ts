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
    where: () => query, whereNull: () => query, count: () => query, insert: async () => undefined,
    update: async (payload: unknown) => { if (table === 'users') mocks.userUpdates.push(payload); },
    select: async () => [],
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

const user = { user_id: 'technician' } as any;
const context = { tenant: 'tenant-1' } as any;
const member = { firstName: 'Tom', lastName: 'Tech', email: 'tom@example.test', role: 'Technician', password: 'NineMinds1234!' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockResolvedValue(false);
  mocks.userUpdates.length = 0;
});

describe('workspace setup access', () => {
  it('reports setup access from the settings:update permission', async () => {
    await expect(actions.getWorkspaceSetupAccess(user, context)).resolves.toEqual({ canRun: false });
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'settings', 'update');
    mocks.hasPermission.mockResolvedValue(true);
    await expect(actions.getWorkspaceSetupAccess(user, context)).resolves.toEqual({ canRun: true });
  });

  it.each([
    ['saveClientInfo', () => actions.saveClientInfo(user, context, { firstName: 'A', lastName: 'B', tenantName: 'T', email: 'a@example.test' } as any)],
    ['addSingleTeamMember', () => actions.addSingleTeamMember(user, context, member)],
    ['addTeamMembers', () => actions.addTeamMembers(user, context, [member])],
    ['createClient', () => actions.createClient(user, context, { clientName: 'C' } as any)],
    ['addClientContact', () => actions.addClientContact(user, context, { contactName: 'C', clientId: 'c' } as any)],
    ['setupBilling', () => actions.setupBilling(user, context, { serviceName: 'S' } as any)],
    ['configureTicketing', () => actions.configureTicketing(user, context, { boardName: 'B' } as any)],
    ['saveOnboardingStepPosition', () => actions.saveOnboardingStepPosition(user, context, 2)],
    ['completeOnboarding', () => actions.completeOnboarding(user, context)],
  ])('%s refuses a user who cannot run workspace setup', async (_name, call) => {
    await expect(call()).resolves.toEqual({ success: false, error: 'Only an administrator can complete workspace setup.' });
    expect(mocks.addUser).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe('workspace setup sign-in email', () => {
  const admin = { user_id: 'admin', email: 'admin@example.test' } as any;
  const info = (email: string) => ({ firstName: 'A', lastName: 'B', tenantName: 'T', email }) as any;
  beforeEach(() => mocks.hasPermission.mockResolvedValue(true));

  it('refuses an email that belongs to another internal account', async () => {
    mocks.findUsersByEmailAndType.mockResolvedValueOnce([{ user_id: 'someone-else' }]);
    const result = await actions.saveClientInfo(admin, context, info('Taken@Example.test'));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('already used by another account') });
    expect(mocks.findUsersByEmailAndType).toHaveBeenCalledWith('taken@example.test', 'internal');
    expect(mocks.userUpdates).toEqual([]);
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
