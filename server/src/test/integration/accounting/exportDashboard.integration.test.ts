import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../../test-utils/testMocks';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

import { AccountingExportRepository } from 'server/src/lib/repositories/accountingExportRepository';
import { AccountingExportService } from 'server/src/lib/services/accountingExportService';
import { AccountingAdapterRegistry } from 'server/src/lib/adapters/accounting/registry';
import { AccountingExportInvoiceSelector } from 'server/src/lib/services/accountingExportInvoiceSelector';
import { AccountingExportAdapterCapabilities } from 'server/src/lib/adapters/accounting/accountingExportAdapter';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 180_000;

class NoopAdapterRegistry extends AccountingAdapterRegistry {
  constructor() {
    super([]);
  }
}

describe('Accounting export dashboard integration', () => {
  let ctx: TestContext;
  let repository: AccountingExportRepository;
  let service: AccountingExportService;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'accounting_export_errors',
        'accounting_export_lines',
        'accounting_export_batches',
        'tenant_external_entity_mappings',
        'transactions',
        'invoice_charges',
        'invoices',
        'service_catalog'
      ]
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();

    await ctx.db('accounting_export_errors').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_lines').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_batches').where({ tenant: ctx.tenantId }).del();
    await ctx.db('tenant_external_entity_mappings').where({ tenant: ctx.tenantId }).del();
    await ctx.db('transactions').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    await ctx.db('service_catalog').where({ tenant: ctx.tenantId }).del();

    repository = new AccountingExportRepository(ctx.db, ctx.tenantId);
    service = new AccountingExportService(repository, new NoopAdapterRegistry());

    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'finance-admin-role',
          tenant: ctx.tenantId,
          role_name: 'Finance Admin',
          permissions: []
        }
      ]
    });

    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: financeUser.user_id,
      user: financeUser,
      permissionCheck: () => true
    });
    mockGetCurrentUser(financeUser);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function ensureClient(clientId: string, name: string) {
    if (!(await ctx.db.schema.hasTable('clients'))) {
      return;
    }
    const existing = await ctx.db('clients')
      .where({ tenant: ctx.tenantId, client_id: clientId })
      .first();
    if (!existing) {
      const now = new Date().toISOString();
      await ctx.db('clients').insert({
        tenant: ctx.tenantId,
        client_id: clientId,
        client_name: name,
        created_at: now,
        updated_at: now,
        status: 'active'
      });
    }
  }

  it('lists batches filtered by status and adapter for dashboard filters', async () => {
    const now = new Date().toISOString();
    const batches = [
      {
        batch_id: uuidv4(),
        tenant: ctx.tenantId,
        adapter_type: 'quickbooks_online',
        export_type: 'invoice',
        status: 'ready',
        queued_at: now,
        created_at: now,
        updated_at: now,
        notes: 'Ready batch'
      },
      {
        batch_id: uuidv4(),
        tenant: ctx.tenantId,
        adapter_type: 'xero',
        export_type: 'invoice',
        status: 'delivered',
        queued_at: now,
        delivered_at: now,
        created_at: now,
        updated_at: now,
        notes: 'Delivered batch'
      },
      {
        batch_id: uuidv4(),
        tenant: ctx.tenantId,
        adapter_type: 'xero',
        export_type: 'invoice',
        status: 'failed',
        queued_at: now,
        created_at: now,
        updated_at: now,
        notes: 'Failed batch'
      }
    ];

    await ctx.db('accounting_export_batches').insert(batches);

    const all = await service.listBatches();
    expect(all).toHaveLength(3);

    const ready = await service.listBatches({ status: 'ready' });
    expect(ready).toHaveLength(1);
    expect(ready[0].batch_id).toBe(batches[0].batch_id);

    const xero = await service.listBatches({ adapter_type: 'xero' });
    expect(xero).toHaveLength(2);
    expect(new Set(xero.map((batch) => batch.status))).toEqual(new Set(['delivered', 'failed']));
  });

  it('provides batch detail with lines and errors for invoice drawer context', async () => {
    const now = new Date().toISOString();
    const batchId = uuidv4();
    const lineId = uuidv4();
    const errorId = uuidv4();

    await ctx.db('accounting_export_batches').insert({
      batch_id: batchId,
      tenant: ctx.tenantId,
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      status: 'needs_attention',
      queued_at: now,
      created_at: now,
      updated_at: now,
      notes: 'Drawer detail test'
    });

    const invoiceId = uuidv4();
    const invoiceCreatedAt = new Date().toISOString();
    await ensureClient(ctx.clientId, 'Primary Client');
    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: 'INV-DRAWER',
      invoice_date: invoiceCreatedAt,
      due_date: invoiceCreatedAt,
      total_amount: 12345,
      subtotal: 12345,
      tax: 0,
      status: 'sent',
      currency_code: 'USD',
      created_at: invoiceCreatedAt,
      updated_at: invoiceCreatedAt
    });

    const chargeId = uuidv4();
    await ctx.db('invoice_charges').insert({
      item_id: chargeId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      service_id: null,
      description: 'Drawer test line',
      quantity: 1,
      unit_price: 12345,
      net_amount: 12345,
      total_price: 12345,
      tax_amount: 0,
      is_manual: false,
      created_at: invoiceCreatedAt,
      updated_at: invoiceCreatedAt
    });

    await ctx.db('accounting_export_lines').insert({
      line_id: lineId,
      batch_id: batchId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      invoice_charge_id: chargeId,
      client_id: ctx.clientId,
      amount_cents: 12345,
      currency_code: 'USD',
      status: 'failed',
      payload: {
        invoice_number: 'INV-2001',
        metadata: { manual_invoice: false }
      },
      notes: 'Missing mapping',
      created_at: now,
      updated_at: now
    });

    await ctx.db('accounting_export_errors').insert({
      error_id: errorId,
      batch_id: batchId,
      tenant: ctx.tenantId,
      line_id: lineId,
      code: 'XERO_VALIDATION_ERROR',
      message: 'Account code missing',
      metadata: { field: 'AccountCode' },
      resolution_state: 'open',
      created_at: now
    });

    const detail = await service.getBatchWithDetails(batchId);
    expect(detail.batch?.batch_id).toBe(batchId);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].notes).toBe('Missing mapping');
    expect(detail.errors).toHaveLength(1);
    expect(detail.errors[0].code).toBe('XERO_VALIDATION_ERROR');
  });

  it('creates a re-export batch via invoice selector for invoice detail workflow', async () => {
    const selector = new AccountingExportInvoiceSelector(ctx.db, ctx.tenantId);
    const invoiceDay = new Date().toISOString().split('T')[0];
    const invoiceTimestamp = new Date(`${invoiceDay}T00:00:00.000Z`).toISOString();
    const now = invoiceTimestamp;
    await ensureClient(ctx.clientId, 'Primary Client');
    const serviceId = await createTestService(ctx, {
      service_name: 'Managed Backup',
      billing_method: 'fixed',
      default_rate: 7500,
      unit_of_measure: 'device',
      description: 'Backup subscription'
    });

    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    const transactionId = uuidv4();

    await ctx.db('tenant_external_entity_mappings').insert([
      {
        id: uuidv4(),
        tenant: ctx.tenantId,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: serviceId,
        external_entity_id: 'QB-SERVICE-123',
        sync_status: 'synced',
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        tenant: ctx.tenantId,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'client',
        alga_entity_id: ctx.clientId,
        external_entity_id: 'QB-CUSTOMER-1',
        sync_status: 'synced',
        created_at: now,
        updated_at: now
      }
    ]);

    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: 'INV-REXPORT-1',
      invoice_date: invoiceTimestamp,
      due_date: invoiceTimestamp,
      total_amount: 7500,
      currency_code: 'USD',
      status: 'sent',
      billing_period_start: invoiceTimestamp,
      billing_period_end: invoiceTimestamp,
      created_at: invoiceTimestamp,
      updated_at: invoiceTimestamp
    });

    await ctx.db('invoice_charges').insert({
      item_id: chargeId,
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      service_id: serviceId,
      description: 'Managed backup - March',
      quantity: 1,
      unit_price: 7500,
      net_amount: 7500,
      total_price: 7500,
      tax_amount: 0,
      is_manual: false,
      created_at: invoiceTimestamp,
      updated_at: invoiceTimestamp
    });

    await ctx.db('transactions').insert({
      transaction_id: transactionId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_id: invoiceId,
      amount: 7500,
      type: 'invoice_generated',
      description: 'Invoice generated',
      created_at: invoiceTimestamp,
      status: 'completed',
      balance_after: 7500
    });

    const filters = {
      startDate: invoiceDay,
      endDate: invoiceDay,
      invoiceStatuses: ['sent'] as string[]
    };

    const preview = await selector.previewInvoiceLines(filters);
    expect(preview).toHaveLength(1);

    vi.spyOn(AccountingExportService, 'create').mockResolvedValue(service);

    const { batch, lines } = await selector.createBatchFromFilters({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-demo',
      filters,
      notes: 'Re-export invoice',
      createdBy: ctx.user.user_id
    });

    expect(batch.status).toBe('pending');
    expect(lines).toHaveLength(1);
    expect(lines[0].invoiceId).toBe(invoiceId);
    expect(lines[0].transactionIds).toContain(transactionId);

    const stored = await service.getBatchWithDetails(batch.batch_id);
    expect(stored.lines).toHaveLength(1);
    const payload = stored.lines[0].payload as Record<string, any>;
    expect(payload.transaction_ids).toContain(transactionId);
  });
});
