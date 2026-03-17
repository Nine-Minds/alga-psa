import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const hasPermission = vi.fn();
const fetchDetailedContractLines = vi.fn();
const getContractLineServicesWithConfigurations = vi.fn();

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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermission(...args),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/contractEventBuilders', () => ({
  buildContractCreatedPayload: vi.fn(() => ({})),
  buildContractRenewalUpcomingPayload: vi.fn(() => ({})),
  computeContractRenewalUpcoming: vi.fn(() => null),
}));

vi.mock('@alga-psa/billing/repositories/contractLineRepository', () => ({
  fetchDetailedContractLines: (...args: any[]) => fetchDetailedContractLines(...args),
  ensureTemplateLineSnapshot: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: (...args: any[]) =>
    getContractLineServicesWithConfigurations(...args),
  getTemplateLineServicesWithConfigurations: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/bucketOverlayActions', () => ({
  upsertBucketOverlayInTransaction: vi.fn(),
}));

type KnexRow = Record<string, unknown> | null;

function makeKnex(rows: { contracts?: KnexRow; client_contracts?: KnexRow }) {
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

  return vi.fn((table: string) => builderFor(table));
}

describe('contract wizard resume client-owned drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermission.mockResolvedValue(true);
  });

  it('T042: resumes a client-owned draft without inferring live assignment status onto the draft header', async () => {
    const knex = makeKnex({
      contracts: {
        contract_id: 'contract-1',
        contract_name: 'Renewal Draft Alpha',
        contract_description: 'Renewal draft',
        owner_client_id: 'client-owned-1',
        status: 'draft',
        billing_frequency: 'monthly',
        currency_code: 'USD',
      },
      client_contracts: {
        contract_id: 'contract-1',
        client_id: 'client-owned-1',
        status: 'renewing',
        start_date: '2026-02-01T00:00:00.000Z',
        end_date: null,
        po_required: false,
        po_number: null,
        po_amount: null,
        template_contract_id: null,
      },
    });
    createTenantKnex.mockResolvedValue({ knex });
    fetchDetailedContractLines.mockResolvedValue([]);

    const { getDraftContractForResume } = await import('@alga-psa/billing/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result).toMatchObject({
      contract_id: 'contract-1',
      contract_name: 'Renewal Draft Alpha',
      client_id: 'client-owned-1',
      is_draft: true,
      billing_frequency: 'monthly',
      currency_code: 'USD',
    });
    expect(result.fixed_services).toEqual([]);
    expect(result.product_services).toEqual([]);
    expect(result.hourly_services).toEqual([]);
    expect(result.usage_services).toEqual([]);
  });
});
