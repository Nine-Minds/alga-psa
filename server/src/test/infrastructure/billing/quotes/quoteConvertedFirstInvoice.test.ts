
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { setupClientTaxConfiguration, assignServiceTaxRate, createTestService, ensureClientPlanBundlesTable } from '../../../../../test-utils/billingTestHelpers';
import { getAvailableRecurringDueWork } from '@alga-psa/billing/actions/billingAndTax';
import { previewGroupedInvoicesForSelectionInputs } from '@alga-psa/billing/actions/invoiceGeneration';
import { generateGroupedInvoicesAsRecurringBillingRun } from '@alga-psa/billing/actions/recurringBillingRunActions';
import { deleteContract } from '@alga-psa/billing/actions/contractActions';
import Contract from '@alga-psa/billing/models/contract';
import { activateClientContractForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { convertQuoteToDraftContract } from '../../../../../../packages/billing/src/services/quoteConversionService';
import { seedBillingCycle } from '../../../../../test-utils/billingProfileTestHelpers';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

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



describe('quote-converted contract first invoice (alga0002168)', () => {
  let context: TestContext;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: ['recurring_service_periods', 'invoice_charges', 'invoices', 'client_billing_cycles', 'client_contracts', 'contract_lines', 'contracts', 'quote_activities', 'quote_items', 'quotes', 'next_number'],
      clientName: 'Rivermark Credit Union',
      userType: 'internal'
    });
  }, 180000);

  beforeEach(async () => {
    context = await resetContext();
    const m = setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    mockedTenantId = m.tenantId;
    mockedUserId = m.userId;
    await context.db('next_number').insert({ tenant: context.tenantId, entity_type: 'INVOICE', prefix: 'INV-', last_number: 0, initial_value: 1, padding_length: 6 }).onConflict().ignore();
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', regionName: 'New York', startDate: '2023-01-01T00:00:00.000Z', taxPercentage: 10 });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
    await ensureClientPlanBundlesTable(context);
    const { db, tenantId: tenant } = { db: context.db, tenantId: context.tenantId };
    await db('clients').where({ tenant, client_id: context.clientId }).update({ billing_cycle: 'monthly' });
    const ym = today.slice(0, 7);
    const d = new Date(ym + '-01T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + 1);
    const next = d.toISOString().slice(0, 10);
    await seedBillingCycle(db as any, tenant, { billing_cycle_id: (await import('uuid')).v4(), tenant, client_id: context.clientId, billing_cycle: 'monthly', effective_date: ym + '-01T00:00:00Z', period_start_date: ym + '-01T00:00:00Z', period_end_date: next + 'T00:00:00Z', created_at: db.fn.now(), updated_at: db.fn.now() } as any);
  }, 60000);

  afterEach(async () => { await rollbackContext(); }, 30000);
  afterAll(async () => { await cleanupContext(); }, 30000);

  const mkService = (name: string, rate: number) =>
    createTestService(context, { service_name: name, billing_method: 'fixed', default_rate: rate, tax_region: 'US-NY' });

  async function quoteAndConvert(title: string, recurring: Array<[string, number, number, string]>, oneTime: boolean) {
    const db = context.db; const tenant = context.tenantId;
    const quote: any = await Quote.create(db as any, tenant, { client_id: context.clientId, title, quote_date: today + 'T00:00:00.000Z', valid_until: today + 'T00:00:00.000Z', subtotal: 0, discount_total: 0, tax: 0, total_amount: 0, currency_code: 'USD', is_template: false } as any);
    for (const [serviceId, quantity, unitPrice, description] of recurring) {
      await QuoteItem.create(db as any, tenant, { quote_id: quote.quote_id, service_id: serviceId, description, quantity, unit_price: unitPrice, is_optional: false, is_selected: true, is_recurring: true, billing_frequency: 'monthly', billing_method: 'fixed', is_discount: false, is_taxable: true } as any);
    }
    if (oneTime) {
      const onboarding = await mkService('Onboarding ' + title, 250000);
      await QuoteItem.create(db as any, tenant, { quote_id: quote.quote_id, service_id: onboarding, description: 'Onboarding', quantity: 1, unit_price: 250000, is_optional: false, is_selected: true, is_recurring: false, is_discount: false, is_taxable: true } as any);
      await QuoteItem.create(db as any, tenant, { quote_id: quote.quote_id, description: 'Custom cabling', quantity: 1, unit_price: 50000, is_optional: false, is_selected: true, is_recurring: false, is_discount: false, is_taxable: true } as any);
    }
    await db('quotes').where({ tenant, quote_id: quote.quote_id }).update({ status: 'accepted', accepted_at: new Date().toISOString() });
    const conv: any = await db.transaction((trx: any) => convertQuoteToDraftContract(trx, tenant, quote.quote_id, null));
    const cc = await db('client_contracts').where({ tenant, contract_id: conv.contract.contract_id }).first();
    return { quoteId: quote.quote_id as string, contractId: conv.contract.contract_id as string, clientContractId: cc.client_contract_id as string };
  }

  async function threeLineQuote(title = 'Q-0012') {
    const s1 = await mkService('Managed Workstations', 150000);
    const s2 = await mkService('Managed Servers', 200000);
    const s3 = await mkService('Backup', 70000);
    return quoteAndConvert(title, [[s1, 1, 150000, 'Workstations'], [s2, 1, 200000, 'Servers'], [s3, 1, 70000, 'Backup']], true);
  }

  async function previewAndRun() {
    const due: any = await getAvailableRecurringDueWork({ pageSize: 100 });
    // Materialization covers a forward horizon, so due work lists several windows;
    // bill only the earliest (current) window, as an operator would for the first invoice.
    const allCands = (due.invoiceCandidates ?? [])
      .filter((c: any) => c.clientId === context.clientId)
      .sort((a: any, b: any) => String(a.windowStart).localeCompare(String(b.windowStart)));
    const cands = allCands.slice(0, 1);
    const groups = cands.map((c: any, i: number) => ({ previewGroupKey: 'g' + i, selectorInputs: c.members.map((m: any) => m.selectorInput) }));
    if (groups.length === 0) return { cands, groups, preview: null as any, run: null as any };
    const preview: any = await previewGroupedInvoicesForSelectionInputs(groups);
    const run: any = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: groups.map((g: any, i: number) => ({
        groupKey: g.previewGroupKey, selectorInputs: g.selectorInputs, billingCycleId: null,
        expectedRecurringPricingSources: preview.previews?.[i]?.expectedRecurringPricingSources
      }))
    });
    return { cands, groups, preview, run };
  }

  it('1. conversion writes the wizard draft shape', async () => {
    const { contractId, clientContractId } = await threeLineQuote();
    const lines = await context.db('contract_lines').where({ tenant: context.tenantId, contract_id: contractId });
    expect(lines).toHaveLength(3);
    expect(lines.every((l: any) => l.is_active === true)).toBe(true);
    const contract = await context.db('contracts').where({ tenant: context.tenantId, contract_id: contractId }).first();
    expect(contract.status).toBe('draft');
    const cc = await context.db('client_contracts').where({ tenant: context.tenantId, client_contract_id: clientContractId }).first();
    expect(cc.is_active).toBe(false);
    const startDate = cc.start_date instanceof Date ? cc.start_date.toISOString().slice(0, 10) : String(cc.start_date).slice(0, 10);
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await context.db('recurring_service_periods').where({ tenant: context.tenantId }).count('* as n').first().then((r: any) => Number(r.n))).toBe(0);
  }, 120000);

  it('2. Set to Active materializes periods, previews $4,200 and generates one invoice', async () => {
    const { contractId, clientContractId } = await threeLineQuote();
    const activation: any = await activateClientContractForBilling(clientContractId);
    expect(activation?.actionError).toBeUndefined();
    const periods = await context.db('recurring_service_periods').where({ tenant: context.tenantId });
    expect(periods.length).toBeGreaterThan(0);

    const { cands, preview, run } = await previewAndRun();
    expect(cands.length).toBeGreaterThan(0);
    expect(preview.success).not.toBe(false);
    const subtotal = (preview.previews ?? []).reduce((sum: number, p: any) => sum + Number(p.data?.subtotal ?? 0), 0);
    expect(subtotal).toBe(420000);
    expect(run.failures).toEqual([]);
    expect(run.invoicesCreated).toBe(1);
    const contract = await context.db('contracts').where({ tenant: context.tenantId, contract_id: contractId }).first();
    expect(contract.status).toBe('active');
  }, 180000);

  it('3. a draft quote contract does not block a healthy contract on the same client', async () => {
    const healthyService = await mkService('Existing Helpdesk', 50000);
    const healthy = await quoteAndConvert('Existing', [[healthyService, 1, 50000, 'Helpdesk']], false);
    await activateClientContractForBilling(healthy.clientContractId);
    await threeLineQuote('Q-draft'); // stays draft, never activated

    const { cands, run } = await previewAndRun();
    expect(cands.length).toBeGreaterThan(0);
    expect(run.failures).toEqual([]);
    expect(run.invoicesCreated).toBe(1);
  }, 180000);

  it('4. legacy shape (lines inactive, cc active) is healed by Set to Active', async () => {
    const { contractId, clientContractId } = await threeLineQuote();
    await context.db('contract_lines').where({ tenant: context.tenantId, contract_id: contractId }).update({ is_active: false });
    await context.db('client_contracts').where({ tenant: context.tenantId, client_contract_id: clientContractId }).update({ is_active: true });

    await activateClientContractForBilling(clientContractId);
    const lines = await context.db('contract_lines').where({ tenant: context.tenantId, contract_id: contractId });
    expect(lines.every((l: any) => l.is_active === true)).toBe(true);

    const { run } = await previewAndRun();
    expect(run.failures).toEqual([]);
    expect(run.invoicesCreated).toBe(1);
  }, 180000);

  it('5. removing one line leaves the other lines billable with no not-materialized refusal', async () => {
    const { contractId, clientContractId } = await threeLineQuote();
    await activateClientContractForBilling(clientContractId);
    const lines = await context.db('contract_lines').where({ tenant: context.tenantId, contract_id: contractId });
    // removeClientContractLine's DB effect (see draftSummary: the action itself cannot be driven with
    // either identity form at this commit). Deactivating one of several lines is what it does.
    await context.db('contract_lines').where({ tenant: context.tenantId, contract_line_id: lines[0].contract_line_id }).update({ is_active: false });

    const { run } = await previewAndRun();
    expect(run.failures.map((f: any) => f.code)).not.toContain('RECURRING_PERIODS_NOT_MATERIALIZED');
    expect(run.failures).toEqual([]);
    expect(run.invoicesCreated).toBe(1);
  }, 180000);

  it('6. a coded generation failure on a quote contract does not prevent a clean delete', async () => {
    const { quoteId, contractId, clientContractId } = await threeLineQuote();
    await activateClientContractForBilling(clientContractId);
    // Force a coded failure: take the due-work selection, then remove the service periods it
    // refers to, so the engine refuses the window with RECURRING_PERIODS_NOT_MATERIALIZED.
    const due: any = await getAvailableRecurringDueWork({ pageSize: 100 });
    const first = (due.invoiceCandidates ?? [])
      .filter((c: any) => c.clientId === context.clientId)
      .sort((a: any, b: any) => String(a.windowStart).localeCompare(String(b.windowStart)))[0];
    expect(first).toBeDefined();
    await context.db('recurring_service_periods').where({ tenant: context.tenantId }).delete();
    const run: any = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [{ groupKey: 'g0', selectorInputs: first.members.map((m: any) => m.selectorInput), billingCycleId: null }]
    });
    expect(run.invoicesCreated).toBe(0);
    expect(run.failures.length).toBeGreaterThan(0);
    expect(run.failures[0].code).toBe('RECURRING_PERIODS_NOT_MATERIALIZED');
    expect(run.failures[0].errorMessage).not.toMatch(/boom|undefined/);

    const result: any = await deleteContract(contractId);
    expect(result?.actionError).toBeUndefined();
    const t = context.tenantId;
    expect((await context.db('quotes').where({ tenant: t, quote_id: quoteId }).first()).converted_contract_id).toBeNull();
    expect(await context.db('quote_activities').where({ tenant: t, quote_id: quoteId, activity_type: 'contract_deleted' }).first()).toBeDefined();
    expect(await context.db('contract_lines').where({ tenant: t, contract_id: contractId })).toHaveLength(0);
    expect(await context.db('client_contracts').where({ tenant: t, contract_id: contractId })).toHaveLength(0);
    expect(await context.db('recurring_service_periods').where({ tenant: t, obligation_id: context.db('contract_lines').select('contract_line_id').where({ contract_id: contractId }) as any })).toHaveLength(0);
  }, 180000);

  it('7. a failing delete rolls back everything it did (atomicity)', async () => {
    const { quoteId, contractId, clientContractId } = await threeLineQuote();
    await activateClientContractForBilling(clientContractId);
    // Test-only FK the delete does not know how to unlink: the final contracts delete fails.
    await context.db.raw('CREATE TABLE zz_contract_ref (tenant uuid NOT NULL, contract_id uuid NOT NULL, FOREIGN KEY (tenant, contract_id) REFERENCES contracts (tenant, contract_id))');
    await context.db('zz_contract_ref').insert({ tenant: context.tenantId, contract_id: contractId });

    // The test context already runs inside one transaction, so a savepoint stands in
    // for the transaction deleteContract opens in production.
    await expect(
      context.db.transaction((sp: any) => Contract.delete(sp, context.tenantId, contractId))
    ).rejects.toMatchObject({ code: '23503' });

    const t = context.tenantId;
    expect(await context.db('contracts').where({ tenant: t, contract_id: contractId }).first()).toBeDefined();
    expect(await context.db('contract_lines').where({ tenant: t, contract_id: contractId })).toHaveLength(3);
    expect(await context.db('client_contracts').where({ tenant: t, contract_id: contractId })).toHaveLength(1);
    expect((await context.db('quotes').where({ tenant: t, quote_id: quoteId }).first()).converted_contract_id).toBe(contractId);
    expect(await context.db('quote_activities').where({ tenant: t, quote_id: quoteId, activity_type: 'contract_deleted' })).toHaveLength(0);
    expect((await context.db('recurring_service_periods').where({ tenant: t })).length).toBeGreaterThan(0);
  }, 180000);
});
