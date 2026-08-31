/**
 * Behavioral coverage for the onboarding read boundary: the reads that sweep
 * remote accounting data (customer match candidates, historical invoice
 * matches) require accounting_catalog:read, while wizard state — a connection
 * diagnostic — stays on billing_settings:read. Assertions check behavior and
 * whether the provider was contacted, never source strings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const permissionRef = vi.hoisted(() => ({
  grants: new Set<string>(),
}));

const authUser = vi.hoisted(() => ({
  user_id: 'user-1',
  tenant: 'tenant-onboarding-test',
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn({ ...authUser, roles: [] }, { tenant: authUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    permissionRef.grants.has(`${resource}:${action}`)
  ),
}));

const qboCreateMock = vi.hoisted(() => vi.fn());
const getDefaultQboRealmIdMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: qboCreateMock },
  getDefaultQboRealmId: getDefaultQboRealmIdMock,
}));

const getQboCustomersMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions/qboActions', () => ({
  getQboCustomers: getQboCustomersMock,
}));

const tenantDbMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: authUser.tenant })),
  tenantDb: tenantDbMock,
  auditLog: vi.fn(),
  withTransaction: vi.fn(async (_knex: unknown, cb: (trx: unknown) => Promise<unknown>) =>
    cb({ raw: vi.fn() })
  ),
}));

import {
  getCustomerMatchCandidates,
  getHistoricalInvoiceMatches,
  getOnboardingWizardState,
} from '../src/actions/qboOnboardingActions';

function grantOnly(...grants: string[]): void {
  permissionRef.grants = new Set(grants);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EDITION = 'ee';
  getDefaultQboRealmIdMock.mockResolvedValue('realm-100');
});

describe('onboarding catalog reads', () => {
  it('denies customer match candidates to a billing_settings:read holder (Project Manager default) without contacting QuickBooks', async () => {
    grantOnly('billing_settings:read');

    await expect(getCustomerMatchCandidates()).rejects.toThrow('Forbidden');
    expect(getQboCustomersMock).not.toHaveBeenCalled();
    expect(qboCreateMock).not.toHaveBeenCalled();
  });

  it('denies historical invoice matches to a billing_settings:read holder without contacting QuickBooks', async () => {
    grantOnly('billing_settings:read');

    await expect(getHistoricalInvoiceMatches()).rejects.toThrow('Forbidden');
    expect(qboCreateMock).not.toHaveBeenCalled();
  });

  it('denies an unauthorized user without contacting QuickBooks', async () => {
    grantOnly();

    await expect(getHistoricalInvoiceMatches()).rejects.toThrow('Forbidden');
    expect(qboCreateMock).not.toHaveBeenCalled();
  });
});

describe('onboarding diagnostics', () => {
  it('serves wizard state to a billing_settings:read holder without catalog access and without provider contact', async () => {
    grantOnly('billing_settings:read');
    tenantDbMock.mockReturnValue({
      table: () => ({
        select: () => ({ first: async () => ({ settings: {} }) }),
      }),
    });

    const state = await getOnboardingWizardState();

    expect(state).toEqual({ completedAt: null, lastRunAt: null, connected: true });
    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(getQboCustomersMock).not.toHaveBeenCalled();
  });
});
