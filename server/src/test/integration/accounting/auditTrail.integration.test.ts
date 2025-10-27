import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi, type SpyInstance } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { AccountingExportInvoiceSelector } from 'server/src/lib/services/accountingExportInvoiceSelector';
import { AccountingExportRepository } from 'server/src/lib/repositories/accountingExportRepository';
import { AccountingExportService } from 'server/src/lib/services/accountingExportService';
import { AccountingAdapterRegistry } from 'server/src/lib/adapters/accounting/registry';
import { AccountingExportBatch } from 'server/src/interfaces/accountingExport.interfaces';
import { createTestService } from '../../../../test-utils/billingTestHelpers';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult
} from 'server/src/lib/adapters/accounting/accountingExportAdapter';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

class StubQuickBooksAdapter implements AccountingExportAdapter {
  readonly type = 'quickbooks_online';

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'api',
      supportsPartialRetry: true,
      supportsInvoiceUpdates: true
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    return {
      documents: context.lines.map((line) => ({
        documentId: `invoice-${line.invoice_id}`,
        lineIds: [line.line_id],
        payload: {
          invoiceId: line.invoice_id,
          amountCents: line.amount_cents
        }
      }))
    };
  }

  async deliver(_transform: AccountingExportTransformResult, context: AccountingExportAdapterContext): Promise<AccountingExportDeliveryResult> {
    return {
      deliveredLines: context.lines.map((line) => ({
        lineId: line.line_id,
        externalDocumentRef: `QB-${line.invoice_id}`
      }))
    };
  }
}

describe('Accounting export audit trail integration', () => {
  let ctx: TestContext;
  let selector: AccountingExportInvoiceSelector;
  let repository: AccountingExportRepository;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'accounting_export_errors',
        'accounting_export_lines',
        'accounting_export_batches',
        'transactions',
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

    await ctx.db('accounting_export_errors').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_lines').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_batches').where({ tenant: ctx.tenantId }).del();
    await ctx.db('transactions').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();

    selector = new AccountingExportInvoiceSelector(ctx.db, ctx.tenantId);
    repository = new AccountingExportRepository(ctx.db, ctx.tenantId);

    const dbModule = await import('server/src/lib/db');
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function seedInvoices(): Promise<{
    filters: { startDate: string; endDate: string; invoiceStatuses: string[] };
    totalAmountCents: number;
    transactionsByInvoice: Record<string, string>;
  }> {
    const invoiceDefinitions = [
      { date: '2025-01-05', total: 10000, description: 'Primary export line A' },
      { date: '2025-01-10', total: 4500, description: 'Primary export line B' }
    ];

    const serviceId = await createTestService(ctx, {
      service_name: 'Audit Export Service',
      billing_method: 'fixed',
      default_rate: 5000,
      unit_of_measure: 'device',
      description: 'Generated for audit trail tests'
    });

    const transactionsByInvoice: Record<string, string> = {};
    let total = 0;

    for (const def of invoiceDefinitions) {
      const invoiceId = uuidv4();
      const chargeId = uuidv4();
      const invoiceDate = new Date(def.date).toISOString();

      await ctx.db('invoices').insert({
        invoice_id: invoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: `INV-${invoiceId.slice(0, 6)}`,
        invoice_date: invoiceDate,
        due_date: invoiceDate,
        subtotal: def.total,
        tax: 0,
        total_amount: def.total,
        status: 'sent',
        currency_code: 'USD',
        is_manual: false,
        created_at: invoiceDate,
        updated_at: invoiceDate
      });

      await ctx.db('invoice_charges').insert({
        item_id: chargeId,
        tenant: ctx.tenantId,
        invoice_id: invoiceId,
        service_id: serviceId,
        description: def.description,
        quantity: 1,
        unit_price: def.total,
        total_price: def.total,
        net_amount: def.total,
        tax_amount: 0,
        is_manual: false,
        created_at: invoiceDate,
        updated_at: invoiceDate
      });

      const transactionId = uuidv4();
      await ctx.db('transactions').insert({
        transaction_id: transactionId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_id: invoiceId,
        amount: def.total,
        type: 'invoice_generated',
        description: `Transaction for ${def.description}`,
        created_at: new Date().toISOString(),
        status: 'completed',
        balance_after: def.total
      });

      total += def.total;
      transactionsByInvoice[invoiceId] = transactionId;
    }

    await ctx.db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant: ctx.tenantId,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'service',
      alga_entity_id: serviceId,
      external_entity_id: 'QB-ITEM-DEFAULT',
      sync_status: 'synced',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    return {
      filters: {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        invoiceStatuses: ['sent']
      },
      totalAmountCents: total,
      transactionsByInvoice
    };
  }

  async function createDeliveredBatch(): Promise<{
    seeded: Awaited<ReturnType<typeof seedInvoices>>;
    batch: AccountingExportBatch;
    previewLines: Awaited<ReturnType<AccountingExportInvoiceSelector['previewInvoiceLines']>>;
    service: AccountingExportService;
    registrySpy: SpyInstance;
    repositorySpy: SpyInstance;
  }> {
    const seeded = await seedInvoices();

    const registrySpy = vi.spyOn(AccountingAdapterRegistry, 'createDefault').mockResolvedValue(new AccountingAdapterRegistry([new StubQuickBooksAdapter()]));
    const repositorySpy = vi.spyOn(AccountingExportRepository, 'create').mockResolvedValue(repository);
    const publishModule = await import('server/src/lib/eventBus/publishers');
    vi.spyOn(publishModule, 'publishEvent').mockResolvedValue();

    const { batch, lines: previewLines } = await selector.createBatchFromFilters({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-500',
      filters: {
        startDate: seeded.filters.startDate,
        endDate: seeded.filters.endDate,
        invoiceStatuses: seeded.filters.invoiceStatuses
      },
      notes: 'Audit integration test'
    });

    expect(previewLines).toHaveLength(2);

    const service = await AccountingExportService.create();
    await service.executeBatch(batch.batch_id);

    return { seeded, batch, previewLines, service, registrySpy, repositorySpy };
  }

  it('creates audit trail artifacts and links transactions to the batch', async () => {
    const { seeded, batch, service, previewLines, registrySpy, repositorySpy } = await createDeliveredBatch();

    const { batch: storedBatch, lines } = await service.getBatchWithDetails(batch.batch_id);
    expect(storedBatch).not.toBeNull();
    expect(storedBatch?.status).toBe('delivered');
    expect(lines).toHaveLength(2);
    lines.forEach((line) => {
      const payload = line.payload as Record<string, any> | undefined;
      expect(payload).toBeTruthy();
      const expectedTransactionId = seeded.transactionsByInvoice[line.invoice_id];
      expect(expectedTransactionId).toBeTruthy();
      expect(payload?.transaction_ids).toContain(expectedTransactionId);
    });

    const transactions = await ctx.db('transactions').where({ tenant: ctx.tenantId });
    expect(transactions).toHaveLength(2);
    transactions.forEach((trx) => {
      const amount = Number(trx.amount);
      expect(amount).toBeGreaterThan(0);
      expect(trx.accounting_export_batch_id).toBe(batch.batch_id);
    });

    const sumAmounts = transactions.reduce((sum: number, trx: any) => sum + Number(trx.amount), 0);
    expect(sumAmounts).toBe(seeded.totalAmountCents);

    const reportRows = await ctx
      .db('transactions')
      .select('transaction_id')
      .where({ tenant: ctx.tenantId, accounting_export_batch_id: batch.batch_id });
    expect(reportRows).toHaveLength(2);

    expect(registrySpy).toHaveBeenCalled();
    expect(repositorySpy).toHaveBeenCalled();
  }, HOOK_TIMEOUT);

  it('supports repository CRUD interactions for audit export records', async () => {
    const { batch, service } = await createDeliveredBatch();

    const listedBatches = await repository.listBatches();
    const found = listedBatches.find((existing) => existing.batch_id === batch.batch_id);
    expect(found).toBeTruthy();
    expect(found?.status).toBe('delivered');

    const postedAt = new Date().toISOString();
    await service.updateBatchStatus(batch.batch_id, {
      status: 'posted',
      posted_at: postedAt,
      notes: 'Marked as posted in integration test'
    });

    const updatedBatch = await repository.getBatch(batch.batch_id);
    expect(updatedBatch?.status).toBe('posted');
    const postedIso =
      updatedBatch?.posted_at instanceof Date
        ? updatedBatch.posted_at.toISOString()
        : typeof updatedBatch?.posted_at === 'string'
          ? new Date(updatedBatch.posted_at).toISOString()
          : null;
    expect(postedIso).toBe(postedAt);
    expect(updatedBatch?.notes).toContain('integration test');

    const lines = await repository.listLines(batch.batch_id);
    expect(lines.length).toBeGreaterThan(0);
    const updatedLine = await repository.updateLine(lines[0].line_id, {
      status: 'posted',
      notes: 'Reviewed in audit trail test'
    });
    expect(updatedLine?.status).toBe('posted');
    expect(updatedLine?.notes).toBe('Reviewed in audit trail test');

    const createdError = await repository.addError({
      batch_id: batch.batch_id,
      line_id: lines[0].line_id,
      code: 'AUDIT_TEST',
      message: 'Simulated issue for audit tracking',
      metadata: { source: 'integration-test' }
    });
    expect(createdError.batch_id).toBe(batch.batch_id);

    const errors = await repository.listErrors(batch.batch_id);
    expect(errors.map((err) => err.error_id)).toContain(createdError.error_id);

    const resolvedError = await repository.updateError(createdError.error_id, {
      resolution_state: 'resolved',
      resolved_at: new Date().toISOString()
    });
    expect(resolvedError?.resolution_state).toBe('resolved');

    const { batch: detailBatch, lines: detailLines, errors: detailErrors } = await service.getBatchWithDetails(batch.batch_id);
    expect(detailBatch?.status).toBe('posted');
    expect(detailLines.some((line) => line.status === 'posted')).toBe(true);
    expect(detailErrors.some((error) => error.error_id === createdError.error_id)).toBe(true);
  }, HOOK_TIMEOUT);
});
