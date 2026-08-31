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
import { QboSimulator } from '../src/services/accountingSync/testing/qboSimulator';

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

  it('matches historical invoices through the TxnDate-windowed simulator query for an authorized user', async () => {
    grantOnly('accounting_catalog:read');
    const sim = new QboSimulator({ realmId: 'realm-100' });
    const customer = sim.seedCustomer({ name: 'Historical Customer' });
    const remoteInvoice = sim.seedInvoice({
      customerId: customer.Id,
      amountCents: 12500,
      docNumber: 'INV-100',
      txnDate: '2026-07-15',
    });
    const providerQuery = vi.spyOn(sim.client, 'query');
    qboCreateMock.mockResolvedValue(sim.client);

    tenantDbMock.mockImplementation(() => ({
      table: (tableName: string) => {
        if (tableName === 'invoices') {
          let status = '';
          const query = {
            where: (criteria: { status?: string }) => {
              status = criteria.status ?? status;
              return query;
            },
            whereNotIn: () => query,
            select: async () => status === 'sent' ? [{
              invoice_id: 'invoice-local-1',
              invoice_number: 'INV-100',
              total_amount: 12500,
              client_id: 'client-local-1',
            }] : [],
          };
          return query;
        }
        if (tableName === 'tenant_external_entity_mappings') {
          const query = {
            where: () => query,
            pluck: async () => [],
            select: async () => [{
              external_entity_id: customer.Id,
              alga_entity_id: 'client-local-1',
            }],
          };
          return query;
        }
        if (tableName === 'audit_logs') {
          return { insert: async () => undefined };
        }
        throw new Error(`Unexpected table ${tableName}`);
      },
    }));

    const result = await getHistoricalInvoiceMatches({ windowStart: '2026-07-01' });

    expect(result.confident).toEqual([expect.objectContaining({
      invoiceId: 'invoice-local-1',
      externalId: remoteInvoice.Id,
      externalDocNumber: 'INV-100',
    })]);
    expect(result.review).toEqual([]);
    expect(qboCreateMock).toHaveBeenCalledTimes(1);
    expect(providerQuery).toHaveBeenCalledWith(
      "SELECT Id, DocNumber, TotalAmt, SyncToken, CustomerRef FROM Invoice WHERE TxnDate >= '2026-07-01' STARTPOSITION 1 MAXRESULTS 1000"
    );
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
