import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

function buildThenableQuery(result: any) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.join = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.andWhere = vi.fn((arg: any) => {
    if (typeof arg === 'function') {
      const callbackBuilder = {
        whereNull: vi.fn(() => callbackBuilder),
        orWhere: vi.fn(() => callbackBuilder),
      };
      arg(callbackBuilder);
    }
    return builder;
  });
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  builder.catch = (onRejected: any) => Promise.resolve(result).catch(onRejected);
  builder.finally = (handler: any) => Promise.resolve(result).finally(handler);
  return builder;
}

describe('contractReportActions expiration report service-period basis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks assignment end dates and renewal decision dates without depending on invoice service-period timing', async () => {
    const expirationRows = [
      {
        client_contract_id: 'cc-1',
        contract_id: 'contract-1',
        contract_name: 'Managed Services',
        client_name: 'Acme Industries',
        is_active: true,
        start_date: '2025-01-01',
        end_date: '2025-07-15',
        decision_due_date: '2025-06-30',
        renewal_mode: 'manual',
        use_tenant_renewal_defaults: false,
        tenant_default_renewal_mode: 'auto',
        queue_status: 'open',
        monthly_value: 10000,
      },
      {
        client_contract_id: 'cc-1',
        contract_id: 'contract-1',
        contract_name: 'Managed Services',
        client_name: 'Acme Industries',
        is_active: true,
        start_date: '2025-01-01',
        end_date: '2025-07-15',
        decision_due_date: '2025-06-30',
        renewal_mode: 'manual',
        use_tenant_renewal_defaults: false,
        tenant_default_renewal_mode: 'auto',
        queue_status: 'open',
        monthly_value: 5000,
      },
      {
        client_contract_id: 'cc-expired',
        contract_id: 'contract-expired',
        contract_name: 'Expired Agreement',
        client_name: 'Old Client',
        is_active: true,
        start_date: '2024-01-01',
        end_date: '2025-06-01',
        decision_due_date: '2025-05-20',
        renewal_mode: 'manual',
        use_tenant_renewal_defaults: false,
        tenant_default_renewal_mode: null,
        queue_status: 'resolved',
        monthly_value: 9000,
      },
    ];

    const knex: any = vi.fn((table: string) => {
      if (table === 'contracts as c') {
        return buildThenableQuery(expirationRows);
      }
      throw new Error(`Unexpected table ${table}`);
    });
    knex.raw = vi.fn((sql: string) => sql);

    createTenantKnex.mockResolvedValue({ knex });

    const { getContractExpirationReport } = await import('@alga-psa/billing/actions/contractReportActions');
    const result = await getContractExpirationReport();

    expect(result).toEqual([
      {
        contract_name: 'Managed Services',
        client_name: 'Acme Industries',
        end_date: '2025-07-15',
        decision_due_date: '2025-06-30',
        renewal_mode: 'manual',
        queue_status: 'open',
        days_until_expiration: 30,
        monthly_value: 15000,
        auto_renew: false,
      },
    ]);
  });
});
