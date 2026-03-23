import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCanonicalDetailPeriods: Array<{ service_period_start: string; service_period_end: string }> = [];
const mockInvoicedCycles: Array<{ period_start_date: string; period_end_date: string }> = [];

vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'mock-user-id' } })),
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'mock-user-id' }, { tenant: 'test-tenant' }, ...args),
  withAuthCheck: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'mock-user-id' }, { tenant: 'test-tenant' }, ...args),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({
      knex: {},
      tenant: 'test-tenant',
    })),
    withTransaction: vi.fn(async (_db: any, callback: any) => {
      const trx = vi.fn((table: string) => {
        const rows =
          table === 'invoice_charge_details as iid'
            ? mockCanonicalDetailPeriods
            : table === 'client_billing_cycles as cbc'
              ? mockInvoicedCycles
              : [];

        const builder: any = {};
        builder.join = vi.fn(() => builder);
        builder.where = vi.fn(() => builder);
        builder.andWhere = vi.fn(() => builder);
        builder.whereNotNull = vi.fn(() => builder);
        builder.orderBy = vi.fn(() => builder);
        builder.select = vi.fn(() => builder);
        builder.then = vi.fn((onFulfilled?: any, onRejected?: any) =>
          Promise.resolve(rows).then(onFulfilled, onRejected)
        );
        return builder;
      });

      return callback(trx);
    }),
  };
});

vi.mock('@alga-psa/clients/models/clientContract', () => ({
  default: {
    getById: vi.fn(async () => ({
      client_contract_id: 'cc-1',
      client_id: 'client-1',
      contract_id: 'contract-1',
      start_date: '2025-12-01T00:00:00Z',
      end_date: null,
      is_active: true,
      tenant: 'test-tenant',
    })),
    updateClientContract: vi.fn(async (_id: string, updateData: any) => ({
      client_contract_id: 'cc-1',
      ...updateData,
    })),
  },
}));

vi.mock('@alga-psa/billing/models/contract', () => ({
  default: {
    checkAndReactivateExpiredContract: vi.fn(async () => undefined),
  },
}));

vi.mock('@alga-psa/shared/billingClients', async () => {
  const actual = await vi.importActual<any>('@alga-psa/shared/billingClients');
  return {
    ...actual,
    checkAndReactivateExpiredContract: vi.fn(async () => undefined),
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

describe('Client contract overlap validation ([start, end) semantics)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanonicalDetailPeriods.length = 0;
    mockInvoicedCycles.length = 0;
    mockInvoicedCycles.push({
      period_start_date: '2026-01-01T00:00:00Z',
      period_end_date: '2026-02-01T00:00:00Z',
    });
  });

  it('does not treat touching boundaries as overlap (start == invoiced period end)', async () => {
    const { updateClientContract } = await import(
      '../../../../packages/clients/src/actions/clientContractActions.ts'
    );

    // Proposed start is exactly the invoiced cycle end boundary: no overlap under [start, end).
    await expect(
      updateClientContract('cc-1', {
        start_date: '2026-02-01T00:00:00Z',
      } as any)
    ).resolves.toBeDefined();
  });

  it('does not treat touching boundaries as overlap (end exclusive == invoiced period start)', async () => {
    const { updateClientContract } = await import(
      '../../../../packages/clients/src/actions/clientContractActions.ts'
    );

    // end_date is stored inclusive; choose end_date so that (end_date + 1 day) == 2026-01-01.
    await expect(
      updateClientContract('cc-1', {
        start_date: '2025-12-01T00:00:00Z',
        end_date: '2025-12-31T00:00:00Z',
      } as any)
    ).resolves.toBeDefined();
  });

  it('rejects true overlaps with an invoiced period', async () => {
    const { updateClientContract } = await import(
      '../../../../packages/clients/src/actions/clientContractActions.ts'
    );

    // Overlaps: [2026-01-15, ...] starts before invoiced end and has no end => overlap.
    await expect(
      updateClientContract('cc-1', {
        start_date: '2026-01-15T00:00:00Z',
      } as any)
    ).rejects.toThrow(/overlap/i);
  });

  it('allows mid-cycle termination on the last billed service day when canonical detail periods cover only part of the invoice window', async () => {
    mockCanonicalDetailPeriods.push({
      service_period_start: '2026-01-10T00:00:00Z',
      service_period_end: '2026-01-20T00:00:00Z',
    });

    const { updateClientContract } = await import(
      '../../../../packages/clients/src/actions/clientContractActions.ts'
    );

    await expect(
      updateClientContract('cc-1', {
        end_date: '2026-01-19T00:00:00Z',
      } as any)
    ).resolves.toBeDefined();
  });

  it('rejects mid-cycle termination that would shorten already-billed canonical service-period coverage', async () => {
    mockCanonicalDetailPeriods.push({
      service_period_start: '2026-01-10T00:00:00Z',
      service_period_end: '2026-01-20T00:00:00Z',
    });

    const { updateClientContract } = await import(
      '../../../../packages/clients/src/actions/clientContractActions.ts'
    );

    await expect(
      updateClientContract('cc-1', {
        end_date: '2026-01-18T00:00:00Z',
      } as any)
    ).rejects.toThrow(
      'Cannot shorten contract end date before 2026-01-19 because recurring service periods are already billed through that day.'
    );
  });
});
