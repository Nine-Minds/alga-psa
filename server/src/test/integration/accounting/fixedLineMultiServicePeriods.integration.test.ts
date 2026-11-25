import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

import {
  AccountingExportInvoiceSelector,
  AccountingExportRepository,
  AccountingExportService,
  AccountingExportValidation
} from '@alga-psa/billing/services';

// No-target Xero exports need a deterministic persisted connection.
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/xero/xeroClientService')>()),
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'xero-default-realm' }),
  getStoredXeroConnections: async () => ({
    'xero-default-realm': { connectionId: 'xero-default-realm', xeroTenantId: 'xero-org-default' }
  })
}));

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

describe('Accounting export: Fixed contract line with several services (alga-2026-0003366)', () => {
  let ctx: TestContext;
  const table = (name: string) => tenantDb(ctx.db, ctx.tenantId).table<any>(name);

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'accounting_export_errors',
        'accounting_export_lines',
        'accounting_export_batches',
        'tenant_external_entity_mappings',
        'invoice_charge_fixed_details',
        'invoice_charge_details',
        'invoice_charges',
        'invoices'
      ]
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    for (const name of [
      'accounting_export_errors',
      'accounting_export_lines',
      'accounting_export_batches',
      'tenant_external_entity_mappings',
      'invoice_charge_fixed_details',
      'invoice_charge_details',
      'invoice_charges',
      'invoices'
    ]) {
      await table(name).where({ tenant: ctx.tenantId }).del();
    }
    const algaDbModule = await import('@alga-psa/db');
    vi.spyOn(algaDbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });
    const repository = new AccountingExportRepository(ctx.db, ctx.tenantId);
    vi.spyOn(AccountingExportRepository, 'create').mockResolvedValue(repository);
    vi.spyOn(AccountingExportService, 'createForTenant').mockResolvedValue(
      new AccountingExportService(repository, {} as any)
    );
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('selects and validates a Fixed line with two services sharing one period as ready', async () => {
    const realm = 'xero-default-realm';
    const now = new Date().toISOString();
    const serviceIds = [
      await createTestService(ctx, { service_name: 'Fixed Service A', billing_method: 'fixed', default_rate: 6000, unit_of_measure: 'device', description: 'A' }),
      await createTestService(ctx, { service_name: 'Fixed Service B', billing_method: 'fixed', default_rate: 4000, unit_of_measure: 'device', description: 'B' })
    ];
    const allocations = [6000, 4000];

    const contractId = uuidv4();
    const contractLineId = uuidv4();
    await ctx.db('contracts').insert({ tenant: ctx.tenantId, contract_id: contractId,
      contract_name: 'Multi-service fixed contract', billing_frequency: 'monthly', is_active: true, is_template: false });
    await ctx.db('contract_lines').insert({ tenant: ctx.tenantId, contract_line_id: contractLineId,
      contract_id: contractId, contract_line_name: 'Fixed bundle', billing_frequency: 'monthly',
      is_active: true, is_template: false });
    const configIds: string[] = [];
    for (const serviceId of serviceIds) {
      const configId = uuidv4();
      configIds.push(configId);
      await ctx.db('contract_line_service_configuration').insert({ tenant: ctx.tenantId, config_id: configId,
        contract_line_id: contractLineId, service_id: serviceId, configuration_type: 'Fixed', quantity: 1 });
    }

    const mappingBase = { tenant: ctx.tenantId, integration_type: 'xero', external_realm_id: realm,
      sync_status: 'synced', created_at: now, updated_at: now };
    await ctx.db('tenant_external_entity_mappings').insert([
      ...serviceIds.map((serviceId, i) => ({ id: uuidv4(), ...mappingBase, alga_entity_type: 'service',
        alga_entity_id: serviceId, external_entity_id: `ITEM-${i + 1}`, metadata: { accountCode: '200' } })),
      { id: uuidv4(), ...mappingBase, alga_entity_type: 'client', alga_entity_id: ctx.clientId,
        external_entity_id: 'CONTACT-001' }
    ]);

    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    const invoiceDate = '2025-02-20T00:00:00.000Z';
    await table('invoices').insert({ invoice_id: invoiceId, tenant: ctx.tenantId, client_id: ctx.clientId,
      invoice_number: 'INV-FIXED-MULTI', invoice_date: invoiceDate, due_date: invoiceDate,
      subtotal: 10000, tax: 0, total_amount: 10000, status: 'sent', currency_code: 'USD', is_manual: false,
      billing_period_start: '2025-02-01T00:00:00.000Z', billing_period_end: '2025-03-01T00:00:00.000Z',
      created_at: invoiceDate, updated_at: invoiceDate });
    await table('invoice_charges').insert({ item_id: chargeId, tenant: ctx.tenantId, invoice_id: invoiceId,
      service_id: null, description: 'Fixed bundle', quantity: 1, unit_price: 10000, total_price: 10000,
      net_amount: 10000, tax_amount: 0, is_manual: false, is_discount: false,
      created_at: invoiceDate, updated_at: invoiceDate });
    for (const [i, serviceId] of serviceIds.entries()) {
      const detailId = uuidv4();
      await table('invoice_charge_details').insert({ item_detail_id: detailId, item_id: chargeId,
        tenant: ctx.tenantId, service_id: serviceId, config_id: configIds[i], quantity: 1, rate: allocations[i],
        service_period_start: '2025-02-01T00:00:00.000Z', service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'advance', created_at: invoiceDate, updated_at: invoiceDate });
      await table('invoice_charge_fixed_details').insert({ tenant: ctx.tenantId, item_detail_id: detailId,
        base_rate: allocations[i], allocated_amount: allocations[i], tax_amount: 0, enable_proration: false,
        fmv: allocations[i], proportion: allocations[i] / 10000 });
    }
    await table('transactions').insert({ transaction_id: uuidv4(), tenant: ctx.tenantId, client_id: ctx.clientId,
      invoice_id: invoiceId, amount: 10000, type: 'invoice_generated', description: 'Fixed multi',
      created_at: invoiceDate, status: 'completed', balance_after: 10000 });

    // Real selector.
    const selector = new AccountingExportInvoiceSelector(ctx.db, ctx.tenantId);
    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'xero',
      filters: { startDate: '2025-01-01', endDate: '2025-02-28', invoiceStatuses: ['sent'], clientIds: [ctx.clientId] },
      notes: 'Fixed multi-service batch'
    });

    const repository = new AccountingExportRepository(ctx.db, ctx.tenantId);
    const lines = await repository.listLines(batch.batch_id);
    expect(lines).toHaveLength(1);
    // The selector payload carries the single deduplicated period.
    expect((lines[0].payload as any).recurring_detail_periods).toEqual([
      { service_period_start: '2025-02-01T00:00:00.000Z', service_period_end: '2025-03-01T00:00:00.000Z', billing_timing: 'advance' }
    ]);

    // Real validation.
    await AccountingExportValidation.ensureMappingsForBatch(batch.batch_id);

    const errors = await repository.listErrors(batch.batch_id);
    expect(errors.filter((e) => e.code === 'service_period_projection_mismatch')).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect((await repository.getBatch(batch.batch_id))?.status).toBe('ready');
  }, HOOK_TIMEOUT);
});
