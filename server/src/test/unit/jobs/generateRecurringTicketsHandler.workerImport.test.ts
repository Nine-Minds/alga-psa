import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
  getConnection: vi.fn(async () => ({})),
  getTenantDefaultLocale: vi.fn(async () => 'en-US'),
  generateRecurringTicketsForTenant: vi.fn(async () => ({ created: 0, skipped: 0, failed: 0 })),
  createTenantKnex: vi.fn(async (tenant: string) => ({ knex: {}, tenant })),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: (...args: unknown[]) => mocks.tenantDb(...args),
}));
vi.mock('@alga-psa/core/server', () => ({ featureFlags: { isEnabled: vi.fn(async () => true) } }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getTenantDefaultLocale: mocks.getTenantDefaultLocale,
}));
vi.mock('@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant', () => ({
  generateRecurringTicketsForTenant: mocks.generateRecurringTicketsForTenant,
}));
vi.mock('server/src/lib/db', () => ({ runWithTenant: mocks.runWithTenant }));
vi.mock('server/src/lib/db/db', () => ({ getConnection: mocks.getConnection }));

import { generateRecurringTicketsHandler } from '../../../lib/jobs/handlers/generateRecurringTicketsHandler';

describe('recurring-ticket worker tenant settings import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantDb.mockReturnValue({
      table: () => ({
        select: () => ({ first: async () => ({ settings: { timezone: 'America/Los_Angeles' } }) }),
      }),
    });
  });

  it('loads the worker-safe tenancy entry and resolves timezone without a Next request context', async () => {
    await generateRecurringTicketsHandler({ tenantId: 'tenant-worker' });

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-worker');
    expect(mocks.tenantDb).toHaveBeenCalledWith({}, 'tenant-worker');
    expect(mocks.generateRecurringTicketsForTenant).toHaveBeenCalledWith(
      {},
      'tenant-worker',
      { timeZone: 'America/Los_Angeles', locale: 'en-US' },
    );
  });
});
