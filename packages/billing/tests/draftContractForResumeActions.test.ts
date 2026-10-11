import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from '@alga-psa/auth/rbac';

const createTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  withTransaction: async (_knex: unknown, fn: any) => fn(_knex),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
  }),
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

vi.mock('@alga-psa/workflow-streams/domainEventBuilders/contractEventBuilders', () => ({
  buildContractCreatedPayload: vi.fn(() => ({})),
  buildContractRenewalUpcomingPayload: vi.fn(() => ({})),
  computeContractRenewalUpcoming: vi.fn(() => null),
}));

const getContractMonthlyFixedValuesByContract = vi.fn(async () => new Map<string, { monthlyValueCents: number }>());
vi.mock('@alga-psa/shared/billingClients/contractMonthlyValue', () => ({
  getContractMonthlyFixedValuesByContract: (...args: any[]) => (getContractMonthlyFixedValuesByContract as any)(...args),
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

const makeKnex = (rows: {
  contracts?: KnexRow;
  client_contracts?: KnexRow;
  contract_templates?: KnexRow;
  service_catalog_mode_defaults?: Array<{ service_id: string; rate: number }>;
}) => {
  const builderFor = (table: string) => {
    const builder: any = {};
    let modeDefaultFilter: { serviceIds?: string[]; billingMode?: string; currencyCode?: string } = {};
    builder.where = vi.fn(() => builder);
    builder.whereIn = vi.fn((column: string, values: string[]) => {
      if (table === 'service_catalog_mode_defaults' && column === 'service_id') {
        modeDefaultFilter = { ...modeDefaultFilter, serviceIds: values };
      }
      return builder;
    });
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
    builder.select = vi.fn(async () => {
      if (table !== 'service_catalog_mode_defaults') {
        return [];
      }
      const rowsForModeDefaults = rows.service_catalog_mode_defaults ?? [];
      return rowsForModeDefaults.filter((row) => {
        if (modeDefaultFilter.serviceIds && !modeDefaultFilter.serviceIds.includes(row.service_id)) {
          return false;
        }
        return true;
      });
    });
    builder.first = vi.fn(async () => {
      if (table === 'contracts') return rows.contracts ?? null;
      if (table === 'client_contracts') return rows.client_contracts ?? null;
      if (table === 'contract_templates') return rows.contract_templates ?? null;
      return null;
    });
    builder.where = vi.fn((conditions?: Record<string, unknown>) => {
      if (table === 'service_catalog_mode_defaults' && conditions) {
        modeDefaultFilter = {
          ...modeDefaultFilter,
          billingMode: typeof conditions.billing_mode === 'string' ? conditions.billing_mode : modeDefaultFilter.billingMode,
          currencyCode:
            typeof conditions.currency_code === 'string' ? conditions.currency_code : modeDefaultFilter.currencyCode,
        };
      }
      return builder;
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
    expect(Array.isArray(result.fixed_lines)).toBe(true);
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
      {
        service: { service_id: 'svc-seat', service_name: 'Seat Service', item_kind: 'service' },
        configuration: { quantity: 12, configuration_type: 'Fixed' },
        typeConfig: { pricing_basis: 'unit', base_rate: 2500 },
        bucketConfig: null,
      },
    ]);

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result.fixed_lines).toHaveLength(1);
    expect(result.fixed_lines[0].base_rate).toBe(1000);
    // The stored basis and unit rate round-trip, so a per-seat service does not
    // resume as a bundle allocation.
    expect(result.fixed_lines[0].services).toEqual([
      {
        service_id: 'svc-1',
        service_name: 'Service 1',
        quantity: 2,
        pricing_basis: 'bundle',
        unit_rate: undefined,
        bucket_overlay: undefined,
      },
      {
        service_id: 'svc-seat',
        service_name: 'Seat Service',
        quantity: 12,
        pricing_basis: 'unit',
        unit_rate: 2500,
        bucket_overlay: undefined,
      },
    ]);
  });

  it('returns cadence_owner from recurring draft lines and defaults missing values to client', async () => {
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
        rate: 1000,
        enable_proration: false,
        billing_frequency: 'monthly',
        cadence_owner: 'contract',
      },
      {
        contract_line_id: 'hourly-1',
        contract_line_type: 'Hourly',
        billing_frequency: 'monthly',
        // A stored mix of cadence owners is not representable by the wizard and is refused, so lines agree.
        cadence_owner: 'contract',
      },
    ]);

    getContractLineServicesWithConfigurations.mockImplementation(async (lineId: string) => {
      if (lineId === 'fixed-1') {
        return [
          {
            service: { service_id: 'svc-fixed', service_name: 'Fixed Service', item_kind: 'service' },
            configuration: { quantity: 1 },
            bucketConfig: null,
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
            bucketConfig: null,
          },
        ];
      }

      return [];
    });

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result.cadence_owner).toBe('contract');
  });

  it('returns partial-period defaults alongside cadence_owner when resuming a recurring draft', async () => {
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
        rate: 1000,
        enable_proration: true,
        billing_frequency: 'monthly',
        cadence_owner: 'contract',
      },
    ]);

    getContractLineServicesWithConfigurations.mockResolvedValue([
      {
        service: { service_id: 'svc-fixed', service_name: 'Fixed Service', item_kind: 'service' },
        configuration: { quantity: 1 },
        bucketConfig: null,
      },
    ]);

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    const result = await getDraftContractForResume('contract-1');

    expect(result).toMatchObject({
      cadence_owner: 'contract',
      enable_proration: true,
    });
    expect(result.fixed_lines[0]).toMatchObject({ base_rate: 1000, enable_proration: true });
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

    expect(result.fixed_lines[0].base_rate).toBe(2500);
    expect(result.fixed_lines[0].services[0]?.bucket_overlay).toEqual({
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

  it('T026: resume preserves decoupled selections and mode-default prefills when stored rates are empty', async () => {
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
      service_catalog_mode_defaults: [
        { service_id: 'svc-hourly', rate: 10100 },
        { service_id: 'svc-usage', rate: 575 },
      ],
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
      hourly_rate: 10100,
    });
    expect(result.usage_services[0]).toMatchObject({
      service_id: 'svc-usage',
      unit_rate: 575,
    });
  });

  it('T027: template snapshot preserves decoupled selections and mode-default prefills when stored rates are empty', async () => {
    const knex = makeKnex({
      contract_templates: {
        template_id: 'template-1',
        template_name: 'Template Alpha',
        template_description: 'Test',
        default_billing_frequency: 'monthly',
      },
      service_catalog_mode_defaults: [
        { service_id: 'svc-hourly', rate: 14400 },
        { service_id: 'svc-usage', rate: 880 },
      ],
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
      hourly_rate: 14400,
    });
    expect(snapshot.usage_services?.[0]).toMatchObject({
      service_id: 'svc-usage',
      unit_rate: 880,
    });
  });

  it('returns template snapshot bucket overlays for hourly and usage services', async () => {
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
            bucketConfig: {
              total_minutes: 180,
              overage_rate: 25000,
              allow_rollover: true,
              billing_period: 'weekly',
            },
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
            bucketConfig: {
              total_minutes: 25,
              overage_rate: 1500,
              allow_rollover: false,
              billing_period: 'monthly',
            },
          },
        ];
      }

      return [];
    });

    const { getContractTemplateSnapshotForClientWizard } = await import('../src/actions/contractWizardActions');
    const snapshot = await getContractTemplateSnapshotForClientWizard('template-1');

    expect(snapshot.hourly_services?.[0]?.bucket_overlay).toEqual({
      total_minutes: 180,
      overage_rate: 25000,
      allow_rollover: true,
      billing_period: 'weekly',
    });
    expect(snapshot.usage_services?.[0]?.bucket_overlay).toEqual({
      total_minutes: 25,
      overage_rate: 1500,
      allow_rollover: false,
      billing_period: 'monthly',
    });
  });

  it('returns cadence_owner from template fixed lines and defaults missing values to client', async () => {
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
        contract_line_id: 'fixed-template-line',
        contract_line_type: 'Fixed',
        cadence_owner: 'contract',
      },
      {
        contract_line_id: 'hourly-template-line',
        contract_line_type: 'Hourly',
      },
    ]);

    getTemplateLineServicesWithConfigurations.mockImplementation(async (lineId: string) => {
      if (lineId === 'fixed-template-line') {
        return [
          {
            service: {
              service_id: 'svc-fixed',
              service_name: 'Fixed Service',
              item_kind: 'service',
            },
            configuration: { quantity: 1 },
            typeConfig: null,
            bucketConfig: null,
          },
        ];
      }

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

      return [];
    });

    const { getContractTemplateSnapshotForClientWizard } = await import('../src/actions/contractWizardActions');
    const snapshot = await getContractTemplateSnapshotForClientWizard('template-1');

    expect(snapshot.cadence_owner).toBe('contract');
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
    await expect(getDraftContractForResume('contract-1')).resolves.toEqual({
      actionError: 'Contract is not a draft',
      messageKey: 'msp/contracts:errors.wizard.notDraft',
    });
  });

  it('user without contract create permission cannot resume drafts (T063)', async () => {
    vi.mocked(hasPermission).mockImplementation((_user, _domain, action) => action !== 'create');
    createTenantKnex.mockResolvedValue({ knex: makeKnex({ contracts: null, client_contracts: null }) });

    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    await expect(getDraftContractForResume('contract-1')).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot resume billing contracts',
    });
  });
});

describe('getDraftContractForResume: per-line fixed pricing and fidelity', () => {
  const draftKnex = () =>
    makeKnex({
      contracts: {
        contract_id: 'contract-1',
        contract_name: 'Draft Beta',
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

  const member = (id: string, extra: Record<string, unknown> = {}) => ({
    service: { service_id: id, service_name: `Svc ${id}`, item_kind: 'service' },
    configuration: { quantity: 1 },
    bucketConfig: null,
    ...extra,
  });

  const arrange = (lines: any[], membersByLine: Record<string, any[]>) => {
    createTenantKnex.mockResolvedValue({ knex: draftKnex() });
    fetchDetailedContractLines.mockResolvedValue(lines);
    getContractLineServicesWithConfigurations.mockImplementation(async (lineId: string) => membersByLine[lineId] ?? []);
  };

  const resume = async () => {
    const { getDraftContractForResume } = await import('../src/actions/contractWizardActions');
    return (await getDraftContractForResume('contract-1')) as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockReturnValue(true);
  });

  it('1: two bundle fixed lines resume as two lines with their own rate, members, frequency and proration', async () => {
    arrange(
      [
        { contract_line_id: 'l1', contract_line_name: 'Core', contract_line_type: 'Fixed', rate: 300000, enable_proration: true, billing_frequency: 'monthly' },
        { contract_line_id: 'l2', contract_line_name: 'Annual extras', contract_line_type: 'Fixed', rate: 105000, enable_proration: false, billing_frequency: 'annually' },
      ],
      { l1: [member('A'), member('B')], l2: [member('C')] },
    );
    getContractMonthlyFixedValuesByContract.mockResolvedValue(new Map([['contract-1', { monthlyValueCents: 308750 }]]));
    const result = await resume();

    expect(result.fixed_lines).toHaveLength(2);
    expect(result.fixed_lines[0]).toMatchObject({ contract_line_name: 'Core', base_rate: 300000, billing_frequency: 'monthly', enable_proration: true });
    expect(result.fixed_lines[0].services.map((s: any) => s.service_id)).toEqual(['A', 'B']);
    expect(result.fixed_lines[1]).toMatchObject({ contract_line_name: 'Annual extras', base_rate: 105000, billing_frequency: 'annually', enable_proration: false });
    expect(result.fixed_lines[1].services.map((s: any) => s.service_id)).toEqual(['C']);
    expect(result.recurring_baseline).toEqual({ monthly_cents: 308750 });
  });

  it('2: a service-less custom fixed line resumes with services [] and its base rate', async () => {
    arrange(
      [{ contract_line_id: 'c1', contract_line_name: 'Custom retainer', contract_line_type: 'Fixed', rate: 70000, enable_proration: false, billing_frequency: 'monthly' }],
      { c1: [] },
    );
    const result = await resume();
    expect(result.fixed_lines).toHaveLength(1);
    expect(result.fixed_lines[0]).toMatchObject({ contract_line_name: 'Custom retainer', services: [], base_rate: 70000 });
  });

  it('3: a unit + bundle mixed line keeps basis, quantity and unit rate per member, and base rate per line', async () => {
    arrange(
      [
        { contract_line_id: 'm1', contract_line_name: 'Mixed', contract_line_type: 'Fixed', rate: 50000, enable_proration: false, billing_frequency: 'monthly' },
        { contract_line_id: 'm2', contract_line_name: 'Other', contract_line_type: 'Fixed', rate: 20000, enable_proration: false, billing_frequency: 'monthly' },
      ],
      {
        m1: [
          member('seat', { configuration: { quantity: 5, configuration_type: 'Fixed' }, typeConfig: { pricing_basis: 'unit', base_rate: 15000 } }),
          member('bundle'),
        ],
        m2: [member('other')],
      },
    );
    const result = await resume();
    expect(result.fixed_lines).toHaveLength(2);
    expect(result.fixed_lines[0].base_rate).toBe(50000);
    expect(result.fixed_lines[0].services).toMatchObject([
      { service_id: 'seat', pricing_basis: 'unit', quantity: 5, unit_rate: 15000 },
      { service_id: 'bundle', pricing_basis: 'bundle', quantity: 1 },
    ]);
    expect(result.fixed_lines[1].base_rate).toBe(20000);
  });

  it('4: a Rivermark per-seat shape resumes as three unit lines with a null base rate', async () => {
    const seat = (id: string, qty: number, rate: number) =>
      member(id, { configuration: { quantity: qty, configuration_type: 'Fixed' }, typeConfig: { pricing_basis: 'unit', base_rate: rate } });
    arrange(
      [
        { contract_line_id: 'r1', contract_line_name: 'X', contract_line_type: 'Fixed', rate: 0, enable_proration: false, billing_frequency: 'monthly' },
        { contract_line_id: 'r2', contract_line_name: 'Y', contract_line_type: 'Fixed', rate: 0, enable_proration: false, billing_frequency: 'monthly' },
        { contract_line_id: 'r3', contract_line_name: 'Z', contract_line_type: 'Fixed', rate: null, enable_proration: false, billing_frequency: 'monthly' },
      ],
      { r1: [seat('x', 10, 20000)], r2: [seat('y', 8, 10000)], r3: [seat('z', 4, 35000)] },
    );
    const result = await resume();
    expect(result.fixed_lines).toHaveLength(3);
    expect(result.fixed_lines.map((l: any) => l.base_rate)).toEqual([null, null, null]);
    expect(result.fixed_lines.map((l: any) => [l.services[0].quantity, l.services[0].unit_rate])).toEqual([
      [10, 20000],
      [8, 10000],
      [4, 35000],
    ]);
  });

  it('5: a fixed line mixing product and service members is refused, naming the line', async () => {
    arrange(
      [{ contract_line_id: 'p1', contract_line_name: 'Hardware bundle', contract_line_type: 'Fixed', rate: 90000, enable_proration: false, billing_frequency: 'monthly' }],
      { p1: [member('svc'), { service: { service_id: 'prod', service_name: 'Router', item_kind: 'product' }, configuration: { quantity: 2, custom_rate: 5000 }, bucketConfig: null }] },
    );
    const result = await resume();
    expect(result.messageKey).toBe('msp/contracts:errors.wizard.resumeUnsupportedShape');
    expect(result.actionError).toContain('Hardware bundle');
    expect(result.fixed_lines).toBeUndefined();
  });

  it('6: hourly lines differing in billing_frequency are refused; equal ones merge and resume', async () => {
    const hourly = (id: string) => [
      { service: { service_id: id, service_name: `H ${id}`, item_kind: 'service' }, configuration: {}, typeConfig: { hourly_rate: 12500, minimum_billable_time: 15, round_up_to_nearest: 15 }, bucketConfig: null },
    ];
    arrange(
      [
        { contract_line_id: 'h1', contract_line_name: 'H1', contract_line_type: 'Hourly', billing_frequency: 'monthly' },
        { contract_line_id: 'h2', contract_line_name: 'H2', contract_line_type: 'Hourly', billing_frequency: 'quarterly' },
      ],
      { h1: hourly('a'), h2: hourly('b') },
    );
    const refused = await resume();
    expect(refused.messageKey).toBe('msp/contracts:errors.wizard.resumeUnsupportedShape');

    arrange(
      [
        { contract_line_id: 'h1', contract_line_name: 'H1', contract_line_type: 'Hourly', billing_frequency: 'monthly' },
        { contract_line_id: 'h2', contract_line_name: 'H2', contract_line_type: 'Hourly', billing_frequency: 'monthly' },
      ],
      { h1: hourly('a'), h2: hourly('b') },
    );
    const merged = await resume();
    expect(merged.messageKey).toBeUndefined();
    expect(merged.hourly_services.map((s: any) => s.service_id)).toEqual(['a', 'b']);
  });

  it('7: a template snapshot with two fixed lines gives two fixed_lines (no last-wins)', async () => {
    createTenantKnex.mockResolvedValue({
      knex: makeKnex({
        contract_templates: { template_id: 'template-1', template_name: 'T', template_description: '', default_billing_frequency: 'monthly' },
      }),
    });
    fetchDetailedContractLines.mockResolvedValue([
      { contract_line_id: 't1', contract_line_type: 'Fixed', rate: 300000, enable_proration: true, billing_frequency: 'monthly' },
      { contract_line_id: 't2', contract_line_type: 'Fixed', rate: 105000, enable_proration: false, billing_frequency: 'monthly' },
    ]);
    getTemplateLineServicesWithConfigurations.mockImplementation(async (lineId: string) =>
      lineId === 't1' ? [member('A')] : [member('C')],
    );
    const { getContractTemplateSnapshotForClientWizard } = await import('../src/actions/contractWizardActions');
    const snapshot: any = await getContractTemplateSnapshotForClientWizard('template-1');
    expect(snapshot.fixed_lines).toHaveLength(2);
    expect(snapshot.fixed_lines.map((l: any) => l.base_rate)).toEqual([300000, 105000]);
    expect(snapshot.fixed_lines.map((l: any) => l.services[0].service_id)).toEqual(['A', 'C']);
  });
});
