import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const getEligibleContractLinesMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
  }),
}));

vi.mock('@alga-psa/billing/lib/contractLineDisambiguation', () => ({
  getEligibleContractLines: (...args: any[]) => getEligibleContractLinesMock(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: any[]) => revalidatePathMock(...args),
}));

vi.mock('@alga-psa/shared/billingClients/drawAdjustments', () => ({
  adjustQuantityDraw: vi.fn(async () => 0),
}));

vi.mock('../src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(async () => null),
}));

type UsageRecord = Record<string, any>;

function createUsageDbStub(options?: { existing?: UsageRecord }) {
  const calls = {
    inserts: [] as UsageRecord[],
    updates: [] as UsageRecord[],
  };

  const db: any = (table: string) => {
    const state: { where?: Record<string, any> } = {};

    if (table === 'usage_tracking') {
      const builder: any = {
        where(criteria: Record<string, any>) {
          state.where = criteria;
          return builder;
        },
        first: async () => options?.existing,
        insert(payload: UsageRecord) {
          calls.inserts.push(payload);
          const record = {
            usage_id: 'usage-created',
            ...payload,
          };
          return {
            returning: async () => [record],
          };
        },
        update(payload: UsageRecord) {
          calls.updates.push(payload);
          const record = {
            ...(options?.existing || {}),
            ...payload,
            usage_id: state.where?.usage_id || 'usage-updated',
            tenant: state.where?.tenant || 'tenant-1',
          };
          return {
            returning: async () => [record],
          };
        },
      };
      return builder;
    }

    if (table === 'contract_line_service_configuration') {
      return {
        where() {
          return {
            first: async () => undefined,
          };
        },
      };
    }

    throw new Error(`Unexpected table ${table}`);
  };

  db.transaction = async (callback: (trx: any) => Promise<any>) => callback(db);

  return { db, calls };
}

describe('usage actions effective-date contract resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T004: createUsageRecord resolves default line with the usage effective date', async () => {
    const { db, calls } = createUsageDbStub();
    createTenantKnexMock.mockResolvedValue({ knex: db });
    getEligibleContractLinesMock.mockResolvedValue([
      { client_contract_line_id: 'line-default' },
    ]);

    const { createUsageRecord } = await import('../src/actions/usageActions');

    await (createUsageRecord as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      {
        client_id: 'client-1',
        service_id: 'service-1',
        quantity: 3,
        usage_date: '2025-02-10',
      },
    );

    expect(getEligibleContractLinesMock).toHaveBeenCalledWith(
      db,
      'tenant-1',
      'client-1',
      'service-1',
      '2025-02-10',
    );
    expect(calls.inserts[0]?.contract_line_id).toBe('line-default');
    expect(calls.inserts[0]?.contract_line_source).toBe('auto_unique_service');
    expect(revalidatePathMock).toHaveBeenCalledWith('/msp/billing');
  });

  it('T004: updateUsageRecord resolves default line using payload usage_date when provided', async () => {
    const { db, calls } = createUsageDbStub({
      existing: {
        usage_id: 'usage-1',
        tenant: 'tenant-1',
        client_id: 'client-1',
        service_id: 'service-1',
        quantity: 1,
        usage_date: '2026-03-11',
        contract_line_id: null,
      },
    });
    createTenantKnexMock.mockResolvedValue({ knex: db });
    getEligibleContractLinesMock.mockResolvedValue([
      { client_contract_line_id: 'line-default-next' },
    ]);

    const { updateUsageRecord } = await import('../src/actions/usageActions');

    await (updateUsageRecord as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      {
        usage_id: 'usage-1',
        usage_date: '2027-08-01',
      },
    );

    expect(getEligibleContractLinesMock).toHaveBeenCalledWith(
      db,
      'tenant-1',
      'client-1',
      'service-1',
      '2027-08-01',
    );
    expect(calls.updates[0]?.contract_line_id).toBe('line-default-next');
    expect(calls.updates[0]?.contract_line_source).toBe('auto_unique_service');
    expect(revalidatePathMock).toHaveBeenCalledWith('/msp/billing');
  });

  it('persists bucket-overlay attribution as an assigned line on usage create', async () => {
    const { db, calls } = createUsageDbStub();
    createTenantKnexMock.mockResolvedValue({ knex: db });
    getEligibleContractLinesMock.mockResolvedValue([
      { client_contract_line_id: 'line-overlay', bucket_overlay: { config_id: 'bucket-1' } },
      { client_contract_line_id: 'line-other' },
    ]);

    const { createUsageRecord } = await import('../src/actions/usageActions');

    await (createUsageRecord as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      {
        client_id: 'client-1',
        service_id: 'service-1',
        quantity: 3,
        usage_date: '2025-02-10',
      },
    );

    expect(calls.inserts[0]).toMatchObject({
      contract_line_id: 'line-overlay',
      contract_line_source: 'auto_bucket_overlay',
      contract_line_unresolved_reason: null,
    });
  });

  it('preserves the original attribution tuple when update resolution fails', async () => {
    const original = {
      usage_id: 'usage-1',
      tenant: 'tenant-1',
      client_id: 'client-1',
      service_id: 'service-1',
      quantity: 1,
      usage_date: '2026-03-11',
      contract_line_id: 'line-original',
      contract_line_source: 'explicit',
      contract_line_unresolved_reason: null,
    };
    const { db, calls } = createUsageDbStub({ existing: original });
    createTenantKnexMock.mockResolvedValue({ knex: db });
    getEligibleContractLinesMock.mockRejectedValue(new Error('resolver unavailable'));

    const { updateUsageRecord } = await import('../src/actions/usageActions');

    await (updateUsageRecord as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { usage_id: 'usage-1', usage_date: '2027-08-01' },
    );

    expect(calls.updates[0]).toMatchObject({
      contract_line_id: 'line-original',
      contract_line_source: 'explicit',
      contract_line_unresolved_reason: null,
    });
  });
});
