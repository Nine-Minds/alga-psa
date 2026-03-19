import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { createClientContractLineCycles } from '../../../../../../packages/billing/src/lib/billing/createBillingCycles';
import { createNextBillingCycle } from '../../../../../../packages/billing/src/actions/billingCycleActions';
import { updateClientBillingCycleAnchor } from '../../../../../../packages/billing/src/actions/billingCycleAnchorActions';
import { updateClientBillingSchedule } from '../../../../../../packages/billing/src/actions/billingScheduleActions';
import { TestContext } from 'server/test-utils/testContext';
import { Temporal } from '@js-temporal/polyfill';
import { TextEncoder as NodeTextEncoder } from 'util';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex } from 'server/src/lib/db';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: mockedUserId,
          tenant: mockedTenantId,
        },
        { tenant: mockedTenantId },
        ...args,
      ),
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<any>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn()
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async () => undefined,
  getAppSecret: async () => undefined,
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/core', () => ({
  getSecret: async () => undefined,
  getAppSecret: async () => undefined,
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/shared/workflow/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/workflow/streams', () => ({
  getRedisStreamClient: () => ({
    publishEvent: vi.fn(),
  }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Client Billing Cycle Anchors', () => {
  let context: TestContext;

  async function createClientCadenceRecurringObligation(options?: {
    startDate?: string;
    endDate?: string | null;
    billingTiming?: 'arrears' | 'advance';
  }) {
    const contractLineId = await context.createEntity('contract_lines', {
      contract_line_name: 'Client Cadence Fixed Plan',
      billing_frequency: 'monthly',
      billing_timing: options?.billingTiming ?? 'arrears',
      is_custom: false,
      contract_line_type: 'Fixed',
      cadence_owner: 'client',
    }, 'contract_line_id');

    const clientContractLineId = uuidv4();
    await context.db('client_contract_lines').insert({
      client_contract_line_id: clientContractLineId,
      client_id: context.clientId,
      contract_line_id: contractLineId,
      start_date: options?.startDate ?? '2025-01-01T00:00:00Z',
      end_date: options?.endDate ?? null,
      is_active: true,
      tenant: context.tenantId,
    });

    return { contractLineId, clientContractLineId };
  }

  async function insertRecurringServicePeriod(options: {
    recordId: string;
    clientContractLineId: string;
    servicePeriodStart: string;
    servicePeriodEnd: string;
    invoiceWindowStart: string;
    invoiceWindowEnd: string;
    lifecycleState?: string;
    provenanceKind?: string;
    reasonCode?: string | null;
    sourceRuleVersion?: string;
    supersedesRecordId?: string | null;
  }) {
    await context.db('recurring_service_periods').insert({
      record_id: options.recordId,
      tenant: context.tenantId,
      schedule_key: `schedule:${context.tenantId}:client_contract_line:${options.clientContractLineId}:client:arrears`,
      period_key: `period:${options.servicePeriodStart}:${options.servicePeriodEnd}`,
      revision: 1,
      obligation_id: options.clientContractLineId,
      obligation_type: 'client_contract_line',
      charge_family: 'fixed',
      cadence_owner: 'client',
      due_position: 'arrears',
      lifecycle_state: options.lifecycleState ?? 'generated',
      service_period_start: options.servicePeriodStart,
      service_period_end: options.servicePeriodEnd,
      invoice_window_start: options.invoiceWindowStart,
      invoice_window_end: options.invoiceWindowEnd,
      activity_window_start: null,
      activity_window_end: null,
      timing_metadata: null,
      provenance_kind: options.provenanceKind ?? 'generated',
      source_rule_version: options.sourceRuleVersion ?? 'legacy',
      reason_code: options.reasonCode ?? 'initial_materialization',
      source_run_key: 'legacy-run',
      supersedes_record_id: options.supersedesRecordId ?? null,
      invoice_id: null,
      invoice_charge_id: null,
      invoice_charge_detail_id: null,
      invoice_linked_at: null,
      created_at: '2025-12-01T00:00:00Z',
      updated_at: '2025-12-01T00:00:00Z',
    });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'client_billing_cycles',
        'client_billing_settings'
      ],
      clientName: 'Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    (createTenantKnex as any).mockResolvedValue({
      knex: context.db,
      tenant: context.tenantId
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'));
  }, 30000);

  afterEach(async () => {
    vi.useRealTimers();
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('creates initial monthly cycle aligned to day=10 anchor (end exclusive)', async () => {
    const { db, client, clientId, tenantId } = context;

    await db('clients')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ billing_cycle: 'monthly' });

    await db('client_billing_settings')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        billing_cycle_anchor_day_of_month: 10,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        billing_cycle_anchor_day_of_month: 10,
        updated_at: new Date()
      });

    await createClientContractLineCycles(db, client);

    const cycles = await db('client_billing_cycles')
      .where({ client_id: clientId, tenant: tenantId, is_active: true })
      .orderBy('period_start_date', 'asc');

    expect(cycles).toHaveLength(1);
    expect(new Date(cycles[0].period_start_date).toISOString().slice(0, 10)).toBe('2025-12-10');
    expect(new Date(cycles[0].period_end_date).toISOString().slice(0, 10)).toBe('2026-01-10');

    const start = Temporal.Instant.from(new Date(cycles[0].period_start_date).toISOString()).toZonedDateTimeISO('UTC');
    const end = Temporal.Instant.from(new Date(cycles[0].period_end_date).toISOString()).toZonedDateTimeISO('UTC');
    expect((end.year - start.year) * 12 + (end.month - start.month)).toBe(1);
  });

  it('manual create-next uses last period_end_date as next start (no duplicate effective_date)', async () => {
    const { db, client, clientId, tenantId } = context;

    await db('clients')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ billing_cycle: 'monthly' });

    await db('client_billing_settings')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        billing_cycle_anchor_day_of_month: 10,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        billing_cycle_anchor_day_of_month: 10,
        updated_at: new Date()
      });

    await createClientContractLineCycles(db, client);
    await createClientContractLineCycles(db, client, { manual: true });

    const cycles = await db('client_billing_cycles')
      .where({ client_id: clientId, tenant: tenantId, is_active: true })
      .orderBy('period_start_date', 'asc');

    expect(cycles).toHaveLength(2);
    expect(new Date(cycles[0].period_end_date).toISOString()).toBe(new Date(cycles[1].period_start_date).toISOString());
    expect(new Date(cycles[1].period_start_date).toISOString()).toMatch(/-10T00:00:00\.000Z$/);
  });

  it('automatic mode backfills cycles up to "now" without overlaps (end exclusive)', async () => {
    const { db, client, clientId, tenantId } = context;

    await db('clients')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ billing_cycle: 'monthly' });

    await db('client_billing_settings')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        billing_cycle_anchor_day_of_month: 10,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        billing_cycle_anchor_day_of_month: 10,
        updated_at: new Date()
      });

    // Seed an old "last active" cycle so we have to backfill multiple cycles to reach 2026-01-09.
    await db('client_billing_cycles').insert({
      billing_cycle_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-01-10T00:00:00Z',
      period_start_date: '2025-01-10T00:00:00Z',
      period_end_date: '2025-02-10T00:00:00Z',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    });

    await createClientContractLineCycles(db, client);

    const cycles = await db('client_billing_cycles')
      .where({ client_id: clientId, tenant: tenantId, is_active: true })
      .orderBy('period_start_date', 'asc');

    expect(cycles.length).toBeGreaterThan(2);

    // Verify contiguity under [start, end) semantics (touching boundaries, no gaps/overlaps).
    for (let i = 1; i < cycles.length; i++) {
      expect(new Date(cycles[i].period_start_date).toISOString()).toBe(new Date(cycles[i - 1].period_end_date).toISOString());
    }

    const last = cycles[cycles.length - 1];
    const lastEnd = Temporal.Instant.from(new Date(last.period_end_date).toISOString()).toZonedDateTimeISO('UTC');
    // With "now" pinned to 2026-01-09, the period covering now should end at the next anchor boundary (Jan 10).
    expect(lastEnd.toPlainDate().toString()).toBe('2026-01-10');
  });

  it('manual createNextBillingCycle respects effectiveDate (anchors initial cycle to that reference)', async () => {
    const { db, client, clientId, tenantId } = context;

    await db('clients')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ billing_cycle: 'monthly' });

    await db('client_billing_settings')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        billing_cycle_anchor_day_of_month: 10,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        billing_cycle_anchor_day_of_month: 10,
        updated_at: new Date()
      });

    const result = await createNextBillingCycle(clientId, '2025-06-15T00:00:00Z');
    expect(result.success).toBe(true);

    const cycles = await db('client_billing_cycles')
      .where({ client_id: clientId, tenant: tenantId, is_active: true })
      .orderBy('period_start_date', 'asc');

    expect(cycles).toHaveLength(1);
    expect(new Date(cycles[0].period_start_date).toISOString().slice(0, 10)).toBe('2025-06-10');
    expect(new Date(cycles[0].period_end_date).toISOString().slice(0, 10)).toBe('2025-07-10');
  });

  it('changing anchor regenerates client-cadence recurring service periods after the billed boundary without mutating future client billing cycles', async () => {
    const { db, client, clientId, tenantId } = context;

    await db('clients')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ billing_cycle: 'monthly' });

    await db('client_billing_settings')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        billing_cycle_anchor_day_of_month: 1,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        billing_cycle_anchor_day_of_month: 1,
        updated_at: new Date()
      });

    // Seed an invoiced cycle ending at the cutover, plus a future non-invoiced cycle.
    const invoicedCycleId = uuidv4();
    const futureCycleId = uuidv4();

    await db('client_billing_cycles').insert([
      {
        billing_cycle_id: invoicedCycleId,
        tenant: tenantId,
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: '2025-12-01T00:00:00Z',
        period_start_date: '2025-12-01T00:00:00Z',
        period_end_date: '2026-01-01T00:00:00Z',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        billing_cycle_id: futureCycleId,
        tenant: tenantId,
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: '2026-01-01T00:00:00Z',
        period_start_date: '2026-01-01T00:00:00Z',
        period_end_date: '2026-02-01T00:00:00Z',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // Mark the first cycle as invoiced so anchor changes cut over after its end boundary.
    await db('invoices').insert({
      tenant: tenantId,
      client_id: clientId,
      billing_cycle_id: invoicedCycleId,
      invoice_number: `INV-${uuidv4().slice(0, 8)}`,
      invoice_date: new Date('2026-01-02T00:00:00Z'),
      due_date: new Date('2026-01-16T00:00:00Z'),
      total_amount: 0,
      status: 'finalized',
      subtotal: 0,
      tax: 0,
      is_manual: false,
      is_prepayment: false,
      currency_code: 'USD',
      tax_source: 'internal'
    });

    const { clientContractLineId } = await createClientCadenceRecurringObligation({
      startDate: '2025-01-01T00:00:00Z',
    });
    const legacyRecurringRecordId = uuidv4();
    await insertRecurringServicePeriod({
      recordId: legacyRecurringRecordId,
      clientContractLineId,
      servicePeriodStart: '2026-01-01',
      servicePeriodEnd: '2026-02-01',
      invoiceWindowStart: '2026-02-01',
      invoiceWindowEnd: '2026-03-01',
      sourceRuleVersion: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
    });

    await updateClientBillingCycleAnchor({
      clientId,
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 10 }
    });

    const futureCycle = await db('client_billing_cycles')
      .where({ tenant: tenantId, billing_cycle_id: futureCycleId })
      .first();
    expect(futureCycle?.is_active).toBe(true);

    const recurringRows = await db('recurring_service_periods')
      .where({ tenant: tenantId, obligation_id: clientContractLineId })
      .orderBy('service_period_start', 'asc')
      .orderBy('revision', 'asc');

    const legacyRow = recurringRows.find((row: any) => row.record_id === legacyRecurringRecordId);
    expect(legacyRow?.lifecycle_state).toBe('superseded');

    const regeneratedRow = recurringRows.find((row: any) => row.supersedes_record_id === legacyRecurringRecordId);
    expect(regeneratedRow).toBeTruthy();
    expect(regeneratedRow?.provenance_kind).toBe('regenerated');
    expect(regeneratedRow?.reason_code).toBe('billing_schedule_changed');
    expect(regeneratedRow?.source_rule_version).toContain('client_schedule|monthly|dom:10');
  });

  it('changing billing cycle type updates the client schedule and regenerates client-cadence recurring service periods without deactivating future client billing cycles', async () => {
    const { db, clientId, tenantId } = context;

    await db('clients')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ billing_cycle: 'monthly' });

    await db('client_billing_settings')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        billing_cycle_anchor_day_of_month: 1,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        billing_cycle_anchor_day_of_month: 1,
        updated_at: new Date()
      });

    const invoicedCycleId = uuidv4();
    const futureCycleId = uuidv4();

    await db('client_billing_cycles').insert([
      {
        billing_cycle_id: invoicedCycleId,
        tenant: tenantId,
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: '2025-12-01T00:00:00Z',
        period_start_date: '2025-12-01T00:00:00Z',
        period_end_date: '2026-01-01T00:00:00Z',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        billing_cycle_id: futureCycleId,
        tenant: tenantId,
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: '2026-01-01T00:00:00Z',
        period_start_date: '2026-01-01T00:00:00Z',
        period_end_date: '2026-02-01T00:00:00Z',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    await db('invoices').insert({
      tenant: tenantId,
      client_id: clientId,
      billing_cycle_id: invoicedCycleId,
      invoice_number: `INV-${uuidv4().slice(0, 8)}`,
      invoice_date: new Date('2026-01-02T00:00:00Z'),
      due_date: new Date('2026-01-16T00:00:00Z'),
      total_amount: 0,
      status: 'finalized',
      subtotal: 0,
      tax: 0,
      is_manual: false,
      is_prepayment: false,
      currency_code: 'USD',
      tax_source: 'internal'
    });

    const { clientContractLineId } = await createClientCadenceRecurringObligation({
      startDate: '2025-01-01T00:00:00Z',
    });
    const legacyRecurringRecordId = uuidv4();
    await insertRecurringServicePeriod({
      recordId: legacyRecurringRecordId,
      clientContractLineId,
      servicePeriodStart: '2026-01-01',
      servicePeriodEnd: '2026-02-01',
      invoiceWindowStart: '2026-02-01',
      invoiceWindowEnd: '2026-03-01',
      sourceRuleVersion: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
    });

    await updateClientBillingSchedule({
      clientId,
      billingCycle: 'quarterly',
      anchor: { monthOfYear: 1, dayOfMonth: 10 }
    });

    const updatedClient = await db('clients').where({ tenant: tenantId, client_id: clientId }).first();
    expect(updatedClient?.billing_cycle).toBe('quarterly');

    const futureCycle = await db('client_billing_cycles')
      .where({ tenant: tenantId, billing_cycle_id: futureCycleId })
      .first();
    expect(futureCycle?.is_active).toBe(true);

    const recurringRows = await db('recurring_service_periods')
      .where({ tenant: tenantId, obligation_id: clientContractLineId })
      .orderBy('service_period_start', 'asc')
      .orderBy('revision', 'asc');

    const legacyRow = recurringRows.find((row: any) => row.record_id === legacyRecurringRecordId);
    expect(legacyRow?.lifecycle_state).toBe('superseded');

    const regeneratedRow = recurringRows.find((row: any) => row.supersedes_record_id === legacyRecurringRecordId);
    expect(regeneratedRow).toBeTruthy();
    expect(regeneratedRow?.provenance_kind).toBe('regenerated');
    expect(regeneratedRow?.reason_code).toBe('billing_schedule_changed');
    expect(regeneratedRow?.source_rule_version).toContain('client_schedule|quarterly|dom:10|moy:1');
  });

  it('unified billing schedule update is atomic for client settings and regenerates client-cadence recurring service periods without mutating client billing cycles', async () => {
    const { db, clientId, tenantId } = context;

    await db('clients')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ billing_cycle: 'monthly' });

    await db('client_billing_settings')
      .where({ tenant: tenantId, client_id: clientId })
      .del();

    const { clientContractLineId } = await createClientCadenceRecurringObligation({
      startDate: '2025-01-01T00:00:00Z',
    });

    // Seed a future client billing cycle to prove schedule management records remain available.
    const futureCycleId = uuidv4();
    await db('client_billing_cycles').insert({
      billing_cycle_id: futureCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: '2026-02-01T00:00:00Z',
      period_start_date: '2026-02-01T00:00:00Z',
      period_end_date: '2026-03-01T00:00:00Z',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    });

    await updateClientBillingSchedule({
      clientId,
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 10 }
    });

    const updatedClient = await db('clients').where({ tenant: tenantId, client_id: clientId }).first();
    expect(updatedClient?.billing_cycle).toBe('monthly');

    const settings = await db('client_billing_settings').where({ tenant: tenantId, client_id: clientId }).first();
    expect(settings?.billing_cycle_anchor_day_of_month).toBe(10);

    const futureCycle = await db('client_billing_cycles')
      .where({ tenant: tenantId, billing_cycle_id: futureCycleId })
      .first();
    expect(futureCycle?.is_active).toBe(true);

    const recurringRows = await db('recurring_service_periods')
      .where({ tenant: tenantId, obligation_id: clientContractLineId })
      .orderBy('service_period_start', 'asc');
    expect(recurringRows.length).toBeGreaterThan(0);
    expect(
      recurringRows.some((row: any) =>
        row.provenance_kind === 'generated'
        && row.reason_code === 'backfill_materialization'
        && String(row.source_rule_version).includes('client_schedule|monthly|dom:10'),
      ),
    ).toBe(true);
  });
});
