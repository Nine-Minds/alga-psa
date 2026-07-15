import { beforeEach, describe, expect, it, vi } from 'vitest';

const IDS = {
  tenant: '10000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000002',
  project: '10000000-0000-4000-8000-000000000003',
  client: '10000000-0000-4000-8000-000000000004',
  config: '10000000-0000-4000-8000-000000000005',
  entry1: '10000000-0000-4000-8000-000000000006',
  entry2: '10000000-0000-4000-8000-000000000007',
  phase: '10000000-0000-4000-8000-000000000008',
  invoice: '10000000-0000-4000-8000-000000000009',
};

const state = vi.hoisted(() => ({
  tenant: '10000000-0000-4000-8000-000000000001',
  user: { user_id: '10000000-0000-4000-8000-000000000002' },
  permissions: new Map<string, boolean>(),
  project: {
    project_id: '10000000-0000-4000-8000-000000000003',
    client_id: '10000000-0000-4000-8000-000000000004',
  },
  clientCurrency: 'USD',
  contractCurrencies: [] as string[],
  config: null as any,
  entries: [] as any[],
  transitionFailure: false,
  publishedEvents: [] as any[],
  generatedInvoiceId: '10000000-0000-4000-8000-000000000009',
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => (
    action(state.user, { tenant: state.tenant }, ...args)
  ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) => (
    state.permissions.get(`${resource}:${action}`) ?? false
  )),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async (event: unknown) => {
    state.publishedEvents.push(event);
  }),
}));

vi.mock('./invoiceGeneration', () => ({
  generateProjectInvoice: vi.fn(async () => ({ invoice_id: state.generatedInvoiceId })),
}));

vi.mock('@alga-psa/db', () => {
  function queryFor(table: string) {
    let whereValues: Record<string, unknown> = {};
    const query: Record<string, any> = {};
    for (const method of [
      'select',
      'whereNotNull',
      'whereIn',
      'andWhere',
      'orWhere',
      'whereNull',
      'max',
      'orderBy',
    ]) {
      query[method] = vi.fn(() => query);
    }
    query.where = vi.fn((condition: unknown) => {
      if (typeof condition === 'function') condition(query);
      else if (condition && typeof condition === 'object') whereValues = { ...whereValues, ...condition };
      return query;
    });
    query.first = vi.fn(async () => {
      if (table === 'projects') return state.project;
      if (table === 'clients') return { default_currency_code: state.clientCurrency };
      if (table === 'default_billing_settings') return { default_currency_code: 'USD' };
      if (table === 'project_phases') {
        return whereValues.phase_id === IDS.phase
          ? { phase_id: IDS.phase, project_id: IDS.project, phase_name: 'Delivery' }
          : undefined;
      }
      if (table === 'project_billing_schedule_entries') {
        const max = state.entries.reduce((value, entry) => Math.max(value, entry.display_order), -1);
        return { max_order: max };
      }
      if (table === 'invoices') return { invoice_number: 'INV-100' };
      return undefined;
    });
    query.distinct = vi.fn(async () => (
      state.contractCurrencies.map((currency_code) => ({ currency_code }))
    ));
    return query;
  }

  return {
    createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: state.tenant })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({})),
    tenantDb: vi.fn(() => ({
      table: vi.fn((table: string) => queryFor(table)),
      tenantJoin: vi.fn(),
    })),
  };
});

vi.mock('../models/projectBillingConfig', () => ({
  default: {
    getById: vi.fn(async (configId: string) => (
      state.config?.config_id === configId ? state.config : null
    )),
    getByProject: vi.fn(async (projectId: string) => (
      state.config?.project_id === projectId ? state.config : null
    )),
    insert: vi.fn(async (input: any) => {
      if (state.config?.project_id === input.project_id) {
        throw new Error('duplicate key value violates unique constraint project_billing_configs_tenant_project_unique');
      }
      state.config = {
        tenant: state.tenant,
        config_id: IDS.config,
        total_price: null,
        contract_id: null,
        cap_amount: null,
        cap_behavior: null,
        cap_notify_thresholds: [75, 90, 100],
        deposit_treatment: 'credit',
        is_taxable: true,
        tax_region: null,
        created_at: '2026-07-15T00:00:00.000Z',
        updated_at: '2026-07-15T00:00:00.000Z',
        ...input,
      };
      return state.config;
    }),
    update: vi.fn(async (configId: string, updates: any) => {
      if (state.config?.config_id !== configId) return null;
      state.config = { ...state.config, ...updates };
      return state.config;
    }),
    delete: vi.fn(async (configId: string) => {
      if (state.config?.config_id !== configId) return false;
      state.config = null;
      return true;
    }),
    getRollupByProject: vi.fn(),
  },
}));

vi.mock('../models/projectBillingCapUsage', () => ({
  default: { getByConfig: vi.fn(async () => null) },
}));

vi.mock('../models/projectPhaseRateOverride', () => ({
  default: {
    listByProject: vi.fn(async () => []),
    getById: vi.fn(async () => null),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../models/projectBillingScheduleEntry', () => ({
  default: {
    getById: vi.fn(async (entryId: string) => (
      state.entries.find((entry) => entry.schedule_entry_id === entryId) ?? null
    )),
    listByConfig: vi.fn(async (configId: string) => (
      state.entries
        .filter((entry) => entry.config_id === configId)
        .sort((left, right) => left.display_order - right.display_order)
    )),
    insert: vi.fn(async (input: any) => {
      const entry = makeEntry({
        ...input,
        schedule_entry_id: state.entries.length === 0 ? IDS.entry1 : IDS.entry2,
      });
      state.entries.push(entry);
      return entry;
    }),
    update: vi.fn(async (entryId: string, updates: any) => {
      const index = state.entries.findIndex((entry) => entry.schedule_entry_id === entryId);
      if (index < 0) return null;
      state.entries[index] = { ...state.entries[index], ...updates };
      return state.entries[index];
    }),
    delete: vi.fn(async (entryId: string) => {
      const index = state.entries.findIndex((entry) => entry.schedule_entry_id === entryId);
      if (index < 0) return false;
      state.entries.splice(index, 1);
      return true;
    }),
    transitionStatus: vi.fn(async (entryId: string, from: string, to: string, extra: any) => {
      if (state.transitionFailure) return null;
      const index = state.entries.findIndex((entry) => (
        entry.schedule_entry_id === entryId && entry.status === from
      ));
      if (index < 0) return null;
      state.entries[index] = { ...state.entries[index], ...extra, status: to };
      return state.entries[index];
    }),
    listReadyQueue: vi.fn(async () => []),
  },
}));

import {
  createProjectBillingConfig,
  deleteProjectBillingConfig,
  updateProjectBillingConfig,
} from './projectBillingConfigActions';
import {
  approveScheduleEntry,
  cancelScheduleEntry,
  createScheduleEntry,
  deleteScheduleEntry,
  holdScheduleEntry,
  markEntryReady,
  updateScheduleEntry,
} from './projectBillingScheduleActions';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    tenant: IDS.tenant,
    config_id: IDS.config,
    project_id: IDS.project,
    billing_model: 'fixed_price',
    total_price: 10_000,
    currency: 'USD',
    invoice_mode: 'standalone',
    contract_id: null,
    cap_amount: null,
    cap_behavior: null,
    cap_notify_thresholds: [75, 90, 100],
    deposit_treatment: 'credit',
    is_taxable: true,
    tax_region: null,
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    tenant: IDS.tenant,
    schedule_entry_id: IDS.entry1,
    config_id: IDS.config,
    entry_type: 'milestone',
    description: 'Discovery complete',
    amount: 5_000,
    percentage: null,
    trigger_type: 'manual',
    phase_id: null,
    trigger_date: null,
    status: 'pending',
    invoice_id: null,
    invoice_charge_id: null,
    ready_at: null,
    approved_at: null,
    approved_by: null,
    invoiced_at: null,
    display_order: 0,
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function allowBillingMutations() {
  state.permissions.set('invoice:create', true);
}

beforeEach(() => {
  state.permissions = new Map([
    ['billing:read', true],
    ['invoice:create', true],
    ['invoice:generate', false],
  ]);
  state.project = { project_id: IDS.project, client_id: IDS.client };
  state.clientCurrency = 'USD';
  state.contractCurrencies = [];
  state.config = null;
  state.entries = [];
  state.transitionFailure = false;
  state.publishedEvents = [];
  vi.clearAllMocks();
});

describe('project billing config action contract', () => {
  it('T002: creates a config with normalized client currency and rejects a second config', async () => {
    const created = await createProjectBillingConfig({
      project_id: IDS.project,
      billing_model: 'fixed_price',
      total_price: 10_000,
      currency: 'usd',
      invoice_mode: 'standalone',
    });

    expect(created).toMatchObject({
      project_id: IDS.project,
      billing_model: 'fixed_price',
      total_price: 10_000,
      currency: 'USD',
    });
    await expect(createProjectBillingConfig({
      project_id: IDS.project,
      billing_model: 'fixed_price',
      total_price: 20_000,
      invoice_mode: 'recurring',
    })).rejects.toThrow(/duplicate key value/);
  });

  it('T002: rejects a currency that differs from the client billing currency', async () => {
    state.clientCurrency = 'EUR';
    await expect(createProjectBillingConfig({
      project_id: IDS.project,
      billing_model: 'fixed_price',
      total_price: 10_000,
      currency: 'USD',
      invoice_mode: 'standalone',
    })).rejects.toThrow("must match the client's billing currency (EUR)");
  });

  it('T003: allows billing-model changes before invoicing and rejects them afterward', async () => {
    state.config = makeConfig();
    await expect(updateProjectBillingConfig(IDS.config, {
      billing_model: 'time_and_materials',
    })).resolves.toMatchObject({ billing_model: 'time_and_materials' });

    state.config = makeConfig();
    state.entries = [makeEntry({ status: 'invoiced' })];
    await expect(updateProjectBillingConfig(IDS.config, {
      billing_model: 'time_and_materials',
    })).rejects.toThrow('Billing model cannot be changed after a schedule entry has been invoiced');
  });

  it('T003: revalidates schedule allocation after total_price edits and returns a warning', async () => {
    state.config = makeConfig();
    state.entries = [makeEntry({ amount: 9_000 })];

    const updated = await updateProjectBillingConfig(IDS.config, { total_price: 12_000 });
    expect(updated).toMatchObject({
      total_price: 12_000,
      allocation_warning: 'Schedule allocation differs from total price by 3000 cents.',
    });
  });
});

describe('project billing schedule action contract', () => {
  beforeEach(() => {
    state.config = makeConfig();
  });

  it('T004: creates and edits a pending entry while enforcing amount XOR percentage', async () => {
    const created = await createScheduleEntry(IDS.config, {
      entry_type: 'milestone',
      description: 'Kickoff',
      percentage: 25,
      trigger_type: 'manual',
    });
    expect(created).toMatchObject({ status: 'pending', percentage: 25, amount: null });

    const updated = await updateScheduleEntry(created.schedule_entry_id, { amount: 2_500 });
    expect(updated).toMatchObject({ amount: 2_500, percentage: null });

    await expect(createScheduleEntry(IDS.config, {
      entry_type: 'milestone',
      description: 'Invalid',
      amount: 1_000,
      percentage: 10,
      trigger_type: 'manual',
    })).rejects.toThrow(/exactly one of amount or percentage is required/i);
  });

  it('T004: keeps invoiced entries immutable and undeletable', async () => {
    state.entries = [makeEntry({ status: 'invoiced' })];
    await expect(updateScheduleEntry(IDS.entry1, { description: 'Changed' })).rejects.toThrow(
      'Only pending schedule entries can be edited',
    );
    await expect(deleteScheduleEntry(IDS.entry1)).rejects.toThrow(
      'Only pending or canceled schedule entries can be deleted',
    );
  });

  it('T006: approves an earlier under-allocated entry with a warning', async () => {
    state.entries = [
      makeEntry({ status: 'ready', amount: 4_000, display_order: 0 }),
      makeEntry({ schedule_entry_id: IDS.entry2, amount: 5_000, display_order: 1 }),
    ];

    const result = await approveScheduleEntry(IDS.entry1);
    expect(result.entry.status).toBe('approved');
    expect(result.allocation_warning).toBe('Schedule is under-allocated by 1000 cents.');
  });

  it('T006: blocks approval when the imbalanced entry is the final unapproved entry', async () => {
    state.entries = [
      makeEntry({ status: 'approved', amount: 4_000, display_order: 0 }),
      makeEntry({ schedule_entry_id: IDS.entry2, status: 'ready', amount: 5_000, display_order: 1 }),
    ];

    await expect(approveScheduleEntry(IDS.entry2)).rejects.toThrow(
      'Schedule is under-allocated by 1000 cents.',
    );
    expect(state.entries[1].status).toBe('ready');
  });

  it('T007: supports pending to ready to approved and rejects illegal source states', async () => {
    state.entries = [makeEntry({ amount: 10_000 })];
    await expect(markEntryReady(IDS.entry1)).resolves.toMatchObject({ status: 'ready' });
    await expect(approveScheduleEntry(IDS.entry1)).resolves.toMatchObject({
      entry: expect.objectContaining({ status: 'approved' }),
    });

    state.entries = [makeEntry({ status: 'pending', amount: 10_000 })];
    await expect(approveScheduleEntry(IDS.entry1)).rejects.toThrow(
      'Only ready schedule entries can be approved',
    );

    state.entries = [makeEntry({ status: 'invoiced', amount: 10_000 })];
    await expect(markEntryReady(IDS.entry1)).rejects.toThrow(
      'Schedule entry must be pending before it can become ready',
    );
  });

  it('T007: optimistic status precondition prevents a double approval', async () => {
    state.entries = [makeEntry({ status: 'ready', amount: 10_000 })];
    state.transitionFailure = true;

    await expect(approveScheduleEntry(IDS.entry1)).rejects.toThrow(
      'Schedule entry status changed before it could be approved',
    );
    expect(state.entries[0].status).toBe('ready');
  });

  it('T010: a deleted phase falls back to a flagged manual trigger that can be marked ready', async () => {
    state.entries = [makeEntry({
      trigger_type: 'phase',
      phase_id: null,
      amount: 10_000,
    })];

    const result = await markEntryReady(IDS.entry1);
    expect(result).toMatchObject({
      status: 'ready',
      trigger_type: 'manual',
      phase_deleted: true,
    });
  });

  it('T026: publishes PROJECT_MILESTONE_READY after a successful ready transition', async () => {
    state.entries = [makeEntry({ amount: 10_000, description: 'Go live' })];

    await markEntryReady(IDS.entry1);

    expect(state.publishedEvents).toEqual([{
      eventType: 'PROJECT_MILESTONE_READY',
      payload: {
        tenantId: IDS.tenant,
        projectId: IDS.project,
        entryId: IDS.entry1,
        description: 'Go live',
        computedAmount: 10_000,
        trigger: 'manual',
      },
    }]);
  });
});

describe('project billing action RBAC contract (T027)', () => {
  beforeEach(() => {
    state.permissions = new Map([
      ['invoice:create', false],
      ['invoice:generate', false],
      ['billing:read', true],
    ]);
    state.config = makeConfig();
    state.entries = [makeEntry({ status: 'ready', amount: 10_000 })];
  });

  it('rejects config CRUD without invoice create or generate permission', async () => {
    await expect(createProjectBillingConfig({
      project_id: IDS.project,
      billing_model: 'fixed_price',
      total_price: 10_000,
      invoice_mode: 'standalone',
    })).rejects.toThrow('Permission denied: invoice create or generate required');
    await expect(updateProjectBillingConfig(IDS.config, { total_price: 11_000 })).rejects.toThrow(
      'Permission denied: invoice create or generate required',
    );
    await expect(deleteProjectBillingConfig(IDS.config)).rejects.toThrow(
      'Permission denied: invoice create or generate required',
    );
  });

  it('rejects approve, hold, cancel, and schedule CRUD without billing mutation permission', async () => {
    await expect(approveScheduleEntry(IDS.entry1)).rejects.toThrow(/invoice create or generate required/);
    await expect(holdScheduleEntry(IDS.entry1, 'Needs review')).rejects.toThrow(/invoice create or generate required/);
    await expect(cancelScheduleEntry(IDS.entry1)).rejects.toThrow(/invoice create or generate required/);
    await expect(createScheduleEntry(IDS.config, {
      entry_type: 'milestone',
      description: 'No permission',
      amount: 100,
      trigger_type: 'manual',
    })).rejects.toThrow(/invoice create or generate required/);
    await expect(updateScheduleEntry(IDS.entry1, { description: 'No permission' })).rejects.toThrow(
      /invoice create or generate required/,
    );
    await expect(deleteScheduleEntry(IDS.entry1)).rejects.toThrow(/invoice create or generate required/);
  });
});
