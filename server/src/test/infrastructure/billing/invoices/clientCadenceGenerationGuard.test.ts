import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  generateInvoiceForSelectionInput,
  previewInvoiceForSelectionInput,
} from '@alga-psa/billing/actions/invoiceGeneration';
import { getAvailableRecurringDueWork } from '@alga-psa/billing/actions/billingAndTax';
import { listUnmaterializedClientCadenceWindowLineIds } from '@alga-psa/billing/lib/billing/clientCadenceWindowMaterialization';
import { buildClientCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { seedBillingCycle } from '../../../../../test-utils/billingProfileTestHelpers';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  assignContractLineToClient,
  createFixedPlanAssignment,
  createTestService,
  ensureClientPlanBundlesTable,
  unwrapInvoiceResult,
} from '../../../../../test-utils/billingTestHelpers';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  assignContractLineToClient,
  createTestService,
  ensureClientPlanBundlesTable,
  unwrapInvoiceResult,
} from '../../../../../test-utils/billingTestHelpers';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;


vi.mock('@alga-psa/auth/rbac', () => ({hasPermission: vi.fn(async () => true)}));
vi.mock('@alga-psa/billing/lib/authHelpers', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentUserAsync: async () => ({user_id: mockedUserId, tenant: mockedTenantId}),
  hasPermissionAsync: async () => true,
}));

vi.mock('@alga-psa/auth/withAuth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return {withAuth: createAuthModuleMock().withAuth};
});

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { capture: vi.fn(), identify: vi.fn(), trackPerformance: vi.fn(), getClient: () => null }
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/workflows/persistence', () => ({ WorkflowEventModel: { create: vi.fn() } }));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({ publishEvent: vi.fn() }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock('server/src/lib/auth/rbac', () => ({ hasPermission: vi.fn(() => Promise.resolve(true)) }));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    user_type: 'internal',
    roles: []
  }))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

const dateOnly = (value: unknown) => new Date(value as string | Date).toISOString().slice(0, 10);

/**
 * alga-2026-0002499: the generation guard (listUnmaterializedClientCadenceWindowLineIds)
 * must use the same contract-scoped obligation start as gap discovery. A line
 * added to an already-billed contract starts at THAT contract's boundary, so it
 * must not be reported missing in the earlier window and must not block a new
 * contract B that starts mid-cycle.
 */
describe('Client-cadence generation guard follows the contract-scoped billed boundary', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'recurring_service_periods', 'invoice_charges', 'invoices', 'client_billing_cycles',
        'client_contract_lines', 'client_contracts', 'contract_line_service_fixed_config',
        'contract_line_service_configuration', 'contract_line_services', 'service_catalog',
        'contract_lines', 'contracts', 'tax_rates', 'tax_regions', 'client_tax_settings',
        'client_tax_rates', 'next_number',
      ],
      clientName: 'Generation Guard Client',
      userType: 'internal',
    });
    const mockContext = setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    const mockContext = setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
    await context.db('next_number').insert({
      tenant: context.tenantId, entity_type: 'INVOICE', prefix: 'INV-', last_number: 0, initial_value: 1, padding_length: 6,
    });
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY', regionName: 'New York', description: 'NY Tax',
      startDate: '2023-01-01T00:00:00.000Z', taxPercentage: 0,
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
    await ensureClientPlanBundlesTable(context);
    await context.db('clients').where({ tenant: context.tenantId, client_id: context.clientId }).update({ billing_cycle: 'monthly' });
  }, 60000);

  afterEach(async () => { await rollbackContext(); }, 30000);
  afterAll(async () => { await cleanupContext(); }, 30000);

  async function seedCycles(months: Array<[string, string]>) {
    for (const [start, end] of months) {
      await seedBillingCycle(context.db, context.tenantId, {
        billing_cycle_id: uuidv4(), tenant: context.tenantId, client_id: context.clientId,
        billing_cycle: 'monthly', effective_date: start, period_start_date: start, period_end_date: end,
        is_active: true, created_at: new Date(), updated_at: new Date(),
      });
    }
  }

  async function insertBilledPeriod(lineId: string, timing: 'advance' | 'arrears', period: [string, string], window: [string, string]) {
    await context.db('recurring_service_periods').insert({
      tenant: context.tenantId, record_id: uuidv4(),
      schedule_key: `schedule:${context.tenantId}:client_contract_line:${lineId}:client:${timing}`,
      period_key: `period:${period[0]}:${period[1]}`, revision: 1,
      obligation_id: lineId, obligation_type: 'client_contract_line', charge_family: 'fixed',
      cadence_owner: 'client', due_position: timing, lifecycle_state: 'billed',
      service_period_start: period[0], service_period_end: period[1],
      invoice_window_start: window[0], invoice_window_end: window[1],
      provenance_kind: 'generated', source_rule_version: 'guard-test-ledger', reason_code: 'initial_materialization',
      created_at: new Date(), updated_at: new Date(),
    });
  }

  /** An add-on line attached to the already-billed contract A (shares A's assignment). */
  async function addAddOnLine(a: { contractId: string; clientContractId: string }, timing: 'advance' | 'arrears') {
    const lineId = await context.createEntity('contract_lines', {
      contract_line_name: `Add-on ${timing}`, billing_frequency: 'monthly', billing_timing: timing,
      is_custom: false, contract_line_type: 'Fixed', cadence_owner: 'client',
    }, 'contract_line_id');
    await assignContractLineToClient(context, lineId, {
      contractId: a.contractId, clientContractId: a.clientContractId,
      startDate: '2026-01-01T00:00:00Z', materializeServicePeriods: true,
    });
    return lineId;
  }

  async function activePeriods(lineId: string) {
    return context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, obligation_id: lineId })
      .whereNotIn('lifecycle_state', ['superseded', 'archived'])
      .orderBy('service_period_start');
  }

  const guard = (windowStart: string, windowEnd: string) => listUnmaterializedClientCadenceWindowLineIds({
    knex: context.db, tenant: context.tenantId, clientId: context.clientId, windowStart, windowEnd,
  });

  async function gapLineIds(lineIds: string[], from: string, to: string) {
    const result = await getAvailableRecurringDueWork({ pageSize: 100, dateRange: { from, to } });
    if ('permissionError' in result) throw new Error(JSON.stringify(result));
    return lineIds.filter((id) => result.materializationGaps.some((gap) => gap.scheduleKey.includes(id)));
  }

  it('advance: a line added to billed contract A does not block new contract B starting mid-cycle', async () => {
    await seedCycles([['2026-03-01', '2026-04-01'], ['2026-04-01', '2026-05-01']]);
    const serviceId = await createTestService(context, {
      service_name: 'Managed Service', billing_method: 'fixed', default_rate: 3100, tax_region: 'US-NY',
    });

    // Contract A: advance-billed for March.
    const a = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Contract A', billingTiming: 'advance', baseRateCents: 3100, startDate: '2026-01-01',
      materializeServicePeriods: false,
    });
    await insertBilledPeriod(a.contractLineId, 'advance', ['2026-03-01', '2026-04-01'], ['2026-03-01', '2026-04-01']);

    // After billing, an add-on line lands on A: first period at A's boundary (04-01).
    const addOnId = await addAddOnLine(a, 'advance');
    expect(dateOnly((await activePeriods(addOnId))[0].service_period_start)).toBe('2026-04-01');

    // New contract B (advance) starts mid-cycle.
    const b = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Contract B', billingTiming: 'advance', baseRateCents: 3100, startDate: '2026-03-15',
      enableProration: true, billingCycleAlignment: 'prorated', materializeServicePeriods: true,
    });
    const bPeriod = (await activePeriods(b.contractLineId))[0];
    expect(dateOnly(bPeriod.invoice_window_start)).toBe('2026-03-01');

    // Guard and gap discovery agree: nothing is missing in March.
    expect(await guard('2026-03-01', '2026-04-01')).toEqual([]);
    expect(await gapLineIds([addOnId, b.contractLineId], '2026-03-01', '2026-05-01')).toEqual([]);

    const selectorInput = buildClientCadenceDueSelectionInput({
      clientId: context.clientId, scheduleKey: bPeriod.schedule_key, periodKey: bPeriod.period_key,
      windowStart: '2026-03-01', windowEnd: '2026-04-01',
    });
    const preview = await previewInvoiceForSelectionInput(selectorInput) as any;
    expect(preview.success).toBe(true);
    expect(preview.data.subtotal).toBe(1700); // 3100 * 17/31
    const invoice = unwrapInvoiceResult(await generateInvoiceForSelectionInput(selectorInput));
    expect(invoice).toMatchObject({ subtotal: 1700 });
  });

  it('arrears: an add-on line on a billed contract is expected one window later than its assignment start implies', async () => {
    await seedCycles([['2026-03-01', '2026-04-01'], ['2026-04-01', '2026-05-01'], ['2026-05-01', '2026-06-01']]);
    const serviceId = await createTestService(context, {
      service_name: 'Managed Service', billing_method: 'fixed', default_rate: 3100, tax_region: 'US-NY',
    });
    // Contract A arrears: February billed in March's window. Boundary = 03-01.
    const a = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Contract A', billingTiming: 'arrears', baseRateCents: 3100, startDate: '2026-01-01',
      materializeServicePeriods: false,
    });
    await insertBilledPeriod(a.contractLineId, 'arrears', ['2026-03-01', '2026-04-01'], ['2026-04-01', '2026-05-01']);

    const addOnId = await addAddOnLine(a, 'arrears');
    // First period is the one at the boundary (03-01..04-01), invoiced in the April window.
    expect(dateOnly((await activePeriods(addOnId))[0].service_period_start)).toBe('2026-04-01');

    // Raw cc.start_date (01-01) would expect it in the March window; the contract boundary does not.
    expect(await guard('2026-03-01', '2026-04-01')).toEqual([]);
    expect(await gapLineIds([addOnId], '2026-03-01', '2026-04-01')).toEqual([]);
    // The window that actually settles its first period expects it: materialized => satisfied...
    expect(await guard('2026-05-01', '2026-06-01')).toEqual([]);
    // ...and once that row is gone, both the guard and gap discovery report it missing.
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId, obligation_id: addOnId, service_period_start: '2026-04-01' }).delete();
    expect(await guard('2026-05-01', '2026-06-01')).toEqual([addOnId]);
    expect(await gapLineIds([addOnId], '2026-03-01', '2026-06-01')).toEqual([addOnId]);
  });
});
