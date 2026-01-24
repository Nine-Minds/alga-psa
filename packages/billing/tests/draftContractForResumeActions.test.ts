import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  withTransaction: async (_knex: unknown, fn: any) => fn(_knex),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/getCurrentUser', () => ({
  getCurrentUser: vi.fn(async () => ({
    id: 'user-1',
    tenant: 'tenant-1',
    roles: [],
  })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

const fetchDetailedContractLines = vi.fn();
vi.mock('../src/repositories/contractLineRepository', () => ({
  fetchDetailedContractLines: (...args: any[]) => fetchDetailedContractLines(...args),
  ensureTemplateLineSnapshot: vi.fn(),
}));

const getContractLineServicesWithConfigurations = vi.fn();
vi.mock('../src/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: (...args: any[]) =>
    getContractLineServicesWithConfigurations(...args),
  getTemplateLineServicesWithConfigurations: vi.fn(),
}));

vi.mock('../src/actions/bucketOverlayActions', () => ({
  upsertBucketOverlayInTransaction: vi.fn(),
}));

type KnexRow = Record<string, unknown> | null;

const makeKnex = (rows: { contracts?: KnexRow; client_contracts?: KnexRow }) => {
  const builderFor = (table: string) => {
    const builder: any = {};
    builder.where = vi.fn(() => builder);
    builder.andWhere = vi.fn((...args: any[]) => {
      if (typeof args[0] === 'function') {
        const whereBuilder = {
          whereNull: vi.fn(() => whereBuilder),
          orWhere: vi.fn(() => whereBuilder),
        };
        args[0](whereBuilder);
      }
      return builder;
    });
    builder.first = vi.fn(async () => {
      if (table === 'contracts') return rows.contracts ?? null;
      if (table === 'client_contracts') return rows.client_contracts ?? null;
      return null;
    });
    return builder;
  };

  const knex: any = vi.fn((table: string) => builderFor(table));
  return knex;
};

describe('getDraftContractForResume action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns complete wizard data for a draft (T027)', async () => {
    const knex = makeKnex({
      contracts: {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        contract_description: 'Desc',
        status: 'draft',
        billing_frequency: 'monthly',
        currency_code: 'USD',
      },
      client_contracts: {
        contract_id: 'contract-1',
        client_id: 'client-1',
        start_date: '2026-01-01T00:00:00.000Z',
        end_date: null,
        po_required: false,
        po_number: null,
        po_amount: null,
        template_contract_id: null,
      },
    });
    createTenantKnex.mockResolvedValue({ knex });
    fetchDetailedContractLines.mockResolvedValue([]);

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result).toMatchObject({
      contract_id: 'contract-1',
      is_draft: true,
      client_id: 'client-1',
      contract_name: 'Draft Alpha',
      billing_frequency: 'monthly',
      currency_code: 'USD',
    });
    expect(Array.isArray(result.fixed_services)).toBe(true);
    expect(Array.isArray(result.product_services)).toBe(true);
    expect(Array.isArray(result.hourly_services)).toBe(true);
    expect(Array.isArray(result.usage_services)).toBe(true);
  });
});
