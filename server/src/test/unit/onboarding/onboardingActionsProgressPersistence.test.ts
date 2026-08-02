import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const trx = {
    fn: {
      now: vi.fn(() => new Date('2026-08-01T00:00:00.000Z')),
    },
  };

  return {
    knex: {},
    trx,
    persistTenantOnboardingProgress: vi.fn(async () => undefined),
    saveTenantOnboardingProgress: vi.fn(async () => {
      throw new Error('Transaction callbacks must not use the public progress action');
    }),
    withTransaction: vi.fn(async (_knex: unknown, callback: (activeTrx: typeof trx) => Promise<unknown>) =>
      callback(trx)
    ),
  };
});

function queryFor(table: string) {
  const query = {
    where: vi.fn(() => query),
    whereNull: vi.fn(() => query),
    first: vi.fn(async () => table === 'service_types' ? { id: 'service-type-1' } : undefined),
    insert: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
  };

  return query;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: mocks.knex })),
  tenantDb: vi.fn(() => ({
    table: (table: string) => queryFor(table),
  })),
  withTransaction: mocks.withTransaction,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: unknown) => handler,
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  persistTenantOnboardingProgress: mocks.persistTenantOnboardingProgress,
}));

vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  saveTenantOnboardingProgress: mocks.saveTenantOnboardingProgress,
  updateTenantOnboardingStatus: vi.fn(async () => ({ success: true })),
}));

vi.mock('@alga-psa/core/encryption', () => ({
  hashPassword: vi.fn(async () => 'hashed-password'),
}));

vi.mock('@alga-psa/core', () => ({
  isValidEmail: vi.fn(() => false),
}));

vi.mock('@alga-psa/clients/actions/clientActions', () => ({
  createClient: vi.fn(),
}));

vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({
  createClientContact: vi.fn(),
}));

vi.mock('../../../../../packages/licensing/src/lib/get-license-usage', () => ({
  getLicenseUsage: vi.fn(async () => ({ limit: null, used: 0 })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  addTeamMembers,
  configureTicketing,
  saveClientInfo,
  setupBilling,
} from '../../../../../packages/onboarding/src/actions/onboarding-actions/onboardingActions';

describe('transaction-owned onboarding progress persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes each action transaction to the internal progress writer', async () => {
    const user = { user_id: 'user-1' } as any;
    const context = { tenant: 'tenant-1' } as any;

    await expect(saveClientInfo(user, context, {
      firstName: '',
      lastName: '',
      tenantName: 'Example tenant',
      email: '',
    })).resolves.toMatchObject({ success: true });

    await expect(addTeamMembers(user, context, [])).resolves.toMatchObject({ success: true });

    await expect(setupBilling(user, context, {
      serviceName: 'Managed service',
      serviceDescription: 'Example service',
      servicePrice: '125',
      contractLineName: 'Managed service line',
      serviceTypeId: 'service-type-1',
    })).resolves.toMatchObject({ success: true });

    await expect(configureTicketing(user, context, {
      boardId: 'board-1',
      boardName: 'Support',
      supportEmail: '',
      categories: [],
      priorities: [],
    })).resolves.toMatchObject({ success: true });

    expect(mocks.withTransaction).toHaveBeenCalledTimes(4);
    expect(mocks.persistTenantOnboardingProgress).toHaveBeenCalledTimes(4);
    for (const [activeTrx, tenant] of mocks.persistTenantOnboardingProgress.mock.calls) {
      expect(activeTrx).toBe(mocks.trx);
      expect(tenant).toBe('tenant-1');
    }
    expect(mocks.saveTenantOnboardingProgress).not.toHaveBeenCalled();
  });
});
