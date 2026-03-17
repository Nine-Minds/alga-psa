import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const getContractLineServicesWithConfigurations = vi.fn();
const getTemplateLineServicesWithConfigurations = vi.fn();

type Row = Record<string, any>;
type RowSet = Record<string, Row[]>;

const normalizeKey = (key: string) => key.split('.').pop() ?? key;

class FakeQuery {
  private filters: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly rows: RowSet,
  ) {}

  where(columnOrFilters: string | Record<string, unknown>, value?: unknown) {
    if (typeof columnOrFilters === 'string') {
      this.filters[normalizeKey(columnOrFilters)] = value;
      return this;
    }

    for (const [key, filterValue] of Object.entries(columnOrFilters)) {
      this.filters[normalizeKey(key)] = filterValue;
    }
    return this;
  }

  andWhere(arg: unknown) {
    if (typeof arg === 'function') {
      const builder = {
        whereNull: vi.fn(() => builder),
        orWhere: vi.fn(() => builder),
      };
      arg(builder);
    }
    return this;
  }

  leftJoin() {
    return this;
  }

  select(_columns?: string[] | string) {
    return this;
  }

  orderBy() {
    return this;
  }

  first(_columns?: string[] | string) {
    return Promise.resolve(this.filteredRows()[0] ?? null);
  }

  then(resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.filteredRows()).then(resolve, reject);
  }

  private filteredRows() {
    const rows = this.rows[this.table] ?? [];
    return rows.filter((row) =>
      Object.entries(this.filters).every(([key, value]) => row[normalizeKey(key)] === value),
    );
  }
}

function createFakeKnex(rows: RowSet) {
  const knex = ((table: string) => new FakeQuery(table, rows)) as any;
  knex.fn = {
    now: () => 'now()',
  };
  return knex;
}

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

vi.mock('../src/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: (...args: any[]) =>
    getContractLineServicesWithConfigurations(...args),
  getTemplateLineServicesWithConfigurations: (...args: any[]) =>
    getTemplateLineServicesWithConfigurations(...args),
}));

vi.mock('../src/actions/bucketOverlayActions', () => ({
  upsertBucketOverlayInTransaction: vi.fn(),
}));

describe('template cadence owner roundtrip actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createTenantKnex.mockResolvedValue({
      knex: createFakeKnex({
        contract_templates: [
          {
            tenant: 'tenant-1',
            template_id: 'template-1',
            template_name: 'Template Alpha',
            template_description: 'Test',
            default_billing_frequency: 'monthly',
          },
        ],
        'contract_template_lines as lines': [
          {
            tenant: 'tenant-1',
            template_id: 'template-1',
            template_line_id: 'hourly-template-line',
            display_order: 0,
            custom_rate: null,
            billing_timing: 'advance',
            cadence_owner: 'contract',
            created_at: '2026-03-17T00:00:00.000Z',
            template_line_name: 'Hourly Template Line',
            line_type: 'Hourly',
            billing_frequency: 'monthly',
            terms_billing_timing: null,
            default_rate: null,
            template_enable_proration: false,
            template_billing_cycle_alignment: 'start',
          },
        ],
        contracts: [
          {
            tenant: 'tenant-1',
            contract_id: 'contract-1',
            contract_name: 'Draft Alpha',
            contract_description: null,
            status: 'draft',
            billing_frequency: 'monthly',
            currency_code: 'USD',
          },
        ],
        client_contracts: [
          {
            tenant: 'tenant-1',
            contract_id: 'contract-1',
            client_id: 'client-1',
            start_date: '2026-01-01T00:00:00.000Z',
            end_date: null,
            po_required: false,
            po_number: null,
            po_amount: null,
            template_contract_id: 'template-1',
          },
        ],
        'contract_lines as cl': [
          {
            tenant: 'tenant-1',
            contract_id: 'contract-1',
            contract_line_id: 'usage-line-1',
            display_order: 0,
            custom_rate: null,
            billing_timing: 'advance',
            cadence_owner: 'contract',
            created_at: '2026-03-17T00:00:00.000Z',
            contract_line_name: 'Usage Contract Line',
            contract_line_type: 'Usage',
            billing_frequency: 'monthly',
            enable_proration: false,
            billing_cycle_alignment: 'start',
          },
        ],
      }),
    });

    getTemplateLineServicesWithConfigurations.mockResolvedValue([
      {
        service: {
          service_id: 'svc-hourly',
          service_name: 'Hourly Service',
          item_kind: 'service',
          default_rate: 12000,
        },
        configuration: { custom_rate: null },
        typeConfig: {
          hourly_rate: 12000,
          minimum_billable_time: 15,
          round_up_to_nearest: 15,
        },
        bucketConfig: null,
      },
    ]);

    getContractLineServicesWithConfigurations.mockResolvedValue([
      {
        service: {
          service_id: 'svc-usage',
          service_name: 'Usage Service',
          item_kind: 'service',
          default_rate: 700,
          unit_of_measure: 'device',
        },
        configuration: { custom_rate: 700 },
        typeConfig: {
          base_rate: 700,
          unit_of_measure: 'device',
          enable_tiered_pricing: false,
        },
        bucketConfig: null,
      },
    ]);
  });

  it('T120: template snapshots and resumed drafts preserve cadence_owner defaults even when the recurring line is not fixed', async () => {
    const {
      getContractTemplateSnapshotForClientWizard,
      getDraftContractForResume,
    } = await import('../src/actions/contractWizardActions');

    const snapshot = await getContractTemplateSnapshotForClientWizard('template-1');
    expect(snapshot).toMatchObject({
      contract_name: 'Template Alpha',
      billing_frequency: 'monthly',
      cadence_owner: 'contract',
    });

    const draft = await getDraftContractForResume('contract-1');
    expect(draft).toMatchObject({
      contract_id: 'contract-1',
      billing_frequency: 'monthly',
      usage_billing_frequency: 'monthly',
      cadence_owner: 'contract',
      template_id: 'template-1',
    });
  });
});
