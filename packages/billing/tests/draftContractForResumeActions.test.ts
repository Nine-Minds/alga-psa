import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from '@alga-psa/auth/rbac';

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

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/contractEventBuilders', () => ({
  buildContractCreatedPayload: vi.fn(() => ({})),
  buildContractRenewalUpcomingPayload: vi.fn(() => ({})),
  computeContractRenewalUpcoming: vi.fn(() => null),
}));

const fetchDetailedContractLines = vi.fn();
vi.mock('../src/repositories/contractLineRepository', () => ({
  fetchDetailedContractLines: (...args: any[]) => fetchDetailedContractLines(...args),
  ensureTemplateLineSnapshot: vi.fn(),
}));

const getContractLineServicesWithConfigurations = vi.fn();
const getTemplateLineServicesWithConfigurations = vi.fn();
vi.mock('../src/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: (...args: any[]) =>
    getContractLineServicesWithConfigurations(...args),
  getTemplateLineServicesWithConfigurations: (...args: any[]) =>
    getTemplateLineServicesWithConfigurations(...args),
}));

vi.mock('../src/actions/bucketOverlayActions', () => ({
  upsertBucketOverlayInTransaction: vi.fn(),
}));

type KnexRow = Record<string, unknown> | null;

const makeKnex = (rows: { contracts?: KnexRow; client_contracts?: KnexRow; contract_templates?: KnexRow }) => {
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
      if (table === 'contract_templates') return rows.contract_templates ?? null;
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
    vi.mocked(hasPermission).mockReturnValue(true);
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

  it('includes contract lines (T028)', async () => {
    const knex = makeKnex({
      contracts: {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        contract_description: null,
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
    fetchDetailedContractLines.mockResolvedValue([
      {
        contract_line_id: 'line-1',
        contract_line_type: 'Fixed',
        // Rates are stored in cents in the database.
        rate: 1000,
        enable_proration: false,
        billing_frequency: 'monthly',
      },
    ]);
    getContractLineServicesWithConfigurations.mockResolvedValue([
      {
        service: { service_id: 'svc-1', service_name: 'Service 1', item_kind: 'service' },
        configuration: { quantity: 2 },
        bucketConfig: null,
      },
    ]);

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result.fixed_base_rate).toBe(1000);
    expect(result.fixed_services).toEqual([
      {
        service_id: 'svc-1',
        service_name: 'Service 1',
        quantity: 2,
        bucket_overlay: undefined,
      },
    ]);
  });

  it('includes service configurations (T029)', async () => {
    const knex = makeKnex({
      contracts: {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        contract_description: null,
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
    fetchDetailedContractLines.mockResolvedValue([
      {
        contract_line_id: 'fixed-1',
        contract_line_type: 'Fixed',
        // Rates are stored in cents in the database.
        rate: 2500,
        enable_proration: true,
        billing_frequency: 'monthly',
      },
      {
        contract_line_id: 'hourly-1',
        contract_line_type: 'Hourly',
        billing_frequency: 'monthly',
      },
      {
        contract_line_id: 'usage-1',
        contract_line_type: 'Usage',
        billing_frequency: 'monthly',
      },
    ]);

    getContractLineServicesWithConfigurations.mockImplementation(async (lineId: string) => {
      if (lineId === 'fixed-1') {
        return [
          {
            service: { service_id: 'svc-fixed', service_name: 'Fixed Service', item_kind: 'service' },
            configuration: { quantity: 1 },
            bucketConfig: {
              total_minutes: 120,
              overage_rate: 1500,
              allow_rollover: true,
              billing_period: 'weekly',
            },
          },
        ];
      }
      if (lineId === 'hourly-1') {
        return [
          {
            service: { service_id: 'svc-hourly', service_name: 'Hourly Service', item_kind: 'service' },
            configuration: {},
            typeConfig: {
              hourly_rate: 12500,
              minimum_billable_time: 15,
              round_up_to_nearest: 5,
            },
            bucketConfig: {
              total_minutes: 60,
              overage_rate: 2000,
              allow_rollover: false,
              billing_period: 'monthly',
            },
          },
        ];
      }
      if (lineId === 'usage-1') {
        return [
          {
            service: { service_id: 'svc-usage', service_name: 'Usage Service', item_kind: 'service', unit_of_measure: 'seat' },
            configuration: {},
            typeConfig: {
              base_rate: 300,
              unit_of_measure: 'seat',
              enable_tiered_pricing: false,
            },
            bucketConfig: {
              total_minutes: 30,
              overage_rate: 2500,
              allow_rollover: true,
              billing_period: 'monthly',
            },
          },
        ];
      }

      return [];
    });

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result.fixed_base_rate).toBe(2500);
    expect(result.fixed_services[0]?.bucket_overlay).toEqual({
      total_minutes: 120,
      overage_rate: 1500,
      allow_rollover: true,
      billing_period: 'weekly',
    });

    expect(result.hourly_services[0]).toMatchObject({
      service_id: 'svc-hourly',
      hourly_rate: 12500,
      bucket_overlay: {
        total_minutes: 60,
        overage_rate: 2000,
        allow_rollover: false,
        billing_period: 'monthly',
      },
    });

    expect(result.minimum_billable_time).toBe(15);
    expect(result.round_up_to_nearest).toBe(5);

    expect(result.usage_services[0]).toMatchObject({
      service_id: 'svc-usage',
      unit_rate: 300,
      unit_of_measure: 'seat',
      bucket_overlay: {
        total_minutes: 30,
        overage_rate: 2500,
        allow_rollover: true,
        billing_period: 'monthly',
      },
    });
  });

  it('falls back to catalog default rates when draft hourly/usage rates are 0 (T029b)', async () => {
    const knex = makeKnex({
      contracts: {
        contract_id: 'contract-1',
        contract_name: 'Draft Alpha',
        contract_description: null,
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
    fetchDetailedContractLines.mockResolvedValue([
      {
        contract_line_id: 'hourly-1',
        contract_line_type: 'Hourly',
        billing_frequency: 'monthly',
      },
      {
        contract_line_id: 'usage-1',
        contract_line_type: 'Usage',
        billing_frequency: 'monthly',
      },
    ]);

    getContractLineServicesWithConfigurations.mockImplementation(async (lineId: string) => {
      if (lineId === 'hourly-1') {
        return [
          {
            service: {
              service_id: 'svc-hourly',
              service_name: 'Hourly Service',
              item_kind: 'service',
              default_rate: 9200,
            },
            configuration: { custom_rate: 0 },
            typeConfig: {
              hourly_rate: 0,
              minimum_billable_time: 15,
              round_up_to_nearest: 5,
            },
            bucketConfig: null,
          },
        ];
      }
      if (lineId === 'usage-1') {
        return [
          {
            service: {
              service_id: 'svc-usage',
              service_name: 'Usage Service',
              item_kind: 'service',
              default_rate: 375,
              unit_of_measure: 'seat',
            },
            configuration: { custom_rate: 0 },
            typeConfig: {
              base_rate: 0,
              unit_of_measure: 'seat',
              enable_tiered_pricing: false,
            },
            bucketConfig: null,
          },
        ];
      }

      return [];
    });

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result.hourly_services[0]).toMatchObject({
      service_id: 'svc-hourly',
      hourly_rate: 9200,
    });
    expect(result.usage_services[0]).toMatchObject({
      service_id: 'svc-usage',
      unit_rate: 375,
    });
  });

  it('falls back to catalog default rates in template snapshot when stored rates are 0', async () => {
    const knex = makeKnex({
      contract_templates: {
        template_id: 'template-1',
        template_name: 'Template Alpha',
        template_description: 'Test',
        default_billing_frequency: 'monthly',
      },
    });
    createTenantKnex.mockResolvedValue({ knex });
    fetchDetailedContractLines.mockResolvedValue([
      {
        contract_line_id: 'hourly-template-line',
        contract_line_type: 'Hourly',
      },
      {
        contract_line_id: 'usage-template-line',
        contract_line_type: 'Usage',
      },
    ]);

    getTemplateLineServicesWithConfigurations.mockImplementation(async (lineId: string) => {
      if (lineId === 'hourly-template-line') {
        return [
          {
            service: {
              service_id: 'svc-hourly',
              service_name: 'Hourly Service',
              item_kind: 'service',
              default_rate: 11300,
            },
            configuration: { custom_rate: 0 },
            typeConfig: {
              hourly_rate: 0,
              minimum_billable_time: 20,
              round_up_to_nearest: 10,
            },
            bucketConfig: null,
          },
        ];
      }
      if (lineId === 'usage-template-line') {
        return [
          {
            service: {
              service_id: 'svc-usage',
              service_name: 'Usage Service',
              item_kind: 'service',
              default_rate: 640,
              unit_of_measure: 'device',
            },
            configuration: { custom_rate: 0 },
            typeConfig: {
              base_rate: 0,
              unit_of_measure: 'device',
              enable_tiered_pricing: false,
            },
            bucketConfig: null,
          },
        ];
      }

      return [];
    });

    const { getContractTemplateSnapshotForClientWizard } = await import('../src/actions/contractWizardActions');
    const snapshot = await getContractTemplateSnapshotForClientWizard('template-1');

    expect(snapshot.hourly_services?.[0]).toMatchObject({
      service_id: 'svc-hourly',
      hourly_rate: 11300,
    });
    expect(snapshot.usage_services?.[0]).toMatchObject({
      service_id: 'svc-usage',
      unit_rate: 640,
    });
  });

  it('throws error if contract is not a draft (T030)', async () => {
    const knex = makeKnex({
      contracts: {
        contract_id: 'contract-1',
        contract_name: 'Active Contract',
        status: 'active',
      },
      client_contracts: null,
    });
    createTenantKnex.mockResolvedValue({ knex });

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    await expect(getDraftContractForResume('contract-1')).rejects.toThrow('Contract is not a draft');
  });

  it('user without contract create permission cannot resume drafts (T063)', async () => {
    vi.mocked(hasPermission).mockImplementation((_user, _domain, action) => action !== 'create');
    createTenantKnex.mockResolvedValue({ knex: makeKnex({ contracts: null, client_contracts: null }) });

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    await expect(getDraftContractForResume('contract-1')).rejects.toThrow('Permission denied: Cannot resume billing contracts');
  });
});
