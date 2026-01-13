import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'mock-user-id' } })),
}));

vi.mock('@shared/db', () => ({
  withTransaction: vi.fn(async (_db: any, callback: any) => {
    const invoicedCycles = [
      {
        period_start_date: '2026-01-01T00:00:00Z',
        period_end_date: '2026-02-01T00:00:00Z',
      },
    ];

    const builder: any = {};
    builder.join = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.andWhere = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.then = vi.fn((onFulfilled?: any, onRejected?: any) =>
      Promise.resolve(invoicedCycles).then(onFulfilled, onRejected)
    );

    const trx = vi.fn(() => builder);
    return callback(trx);
  }),
}));

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<any>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({
      knex: {},
      tenant: 'test-tenant',
    })),
  };
});

vi.mock('server/src/lib/models/clientContract', () => ({
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

vi.mock('server/src/lib/models/contract', () => ({
  default: {
    checkAndReactivateExpiredContract: vi.fn(async () => undefined),
  },
}));

describe('Client contract overlap validation ([start, end) semantics)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not treat touching boundaries as overlap (start == invoiced period end)', async () => {
    const { updateClientContract } = await import(
      'server/src/lib/actions/client-actions/clientContractActions'
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
      'server/src/lib/actions/client-actions/clientContractActions'
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
      'server/src/lib/actions/client-actions/clientContractActions'
    );

    // Overlaps: [2026-01-15, ...] starts before invoiced end and has no end => overlap.
    await expect(
      updateClientContract('cc-1', {
        start_date: '2026-01-15T00:00:00Z',
      } as any)
    ).rejects.toThrow(/overlap/i);
  });
});
