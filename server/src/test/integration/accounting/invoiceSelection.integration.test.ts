import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';
import { createClient } from '../../../../test-utils/testDataFactory';

import { AccountingExportInvoiceSelector, InvoiceSelectionFilters } from 'server/src/lib/services/accountingExportInvoiceSelector';
import { AccountingExportRepository } from 'server/src/lib/repositories/accountingExportRepository';
import { AccountingExportService } from 'server/src/lib/services/accountingExportService';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

type SeededInvoice = {
  invoiceId: string;
  chargeId: string;
  transactionId: string;
};

type SeededDataset = {
  manual: SeededInvoice;
  multiPeriod: SeededInvoice;
  credit: SeededInvoice;
  zeroAmount: SeededInvoice;
  filters: InvoiceSelectionFilters;
};

describe('Accounting export invoice selection integration', () => {
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
        'invoices',
        'companies'
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
    if (await ctx.db.schema.hasTable('companies')) {
      await ctx.db('companies').where({ tenant: ctx.tenantId }).del();
    }

    selector = new AccountingExportInvoiceSelector(ctx.db, ctx.tenantId);
    repository = new AccountingExportRepository(ctx.db, ctx.tenantId);

    const dbModule = await import('server/src/lib/db');
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function ensureCompany(companyId: string, companyName: string) {
    if (!(await ctx.db.schema.hasTable('companies'))) {
      return;
    }

    const exists = await ctx.db('companies')
      .where({ tenant: ctx.tenantId, company_id: companyId })
      .first();

    if (!exists) {
      const now = new Date().toISOString();
      await ctx.db('companies').insert({
        tenant: ctx.tenantId,
        company_id: companyId,
        company_name: companyName,
        created_at: now,
        updated_at: now,
        billing_cycle: 'monthly'
      });
    }
  }

  async function seedInvoices(): Promise<SeededDataset> {
    const secondaryClientId = await createClient(ctx.db, ctx.tenantId, 'Secondary Client');

    await ensureCompany(ctx.clientId, 'Primary Client');
    await ensureCompany(secondaryClientId, 'Secondary Client');

    const serviceId = await createTestService(ctx, {
      service_name: 'Managed Endpoint',
      billing_method: 'fixed',
      default_rate: 5000,
      unit_of_measure: 'device',
      description: 'Endpoint management service'
    });

    const now = new Date();

    const invoices: Record<string, SeededInvoice> = {} as any;

    async function insertInvoice(params: {
      key: keyof SeededDataset;
      invoiceDate: string;
      status?: string;
      clientId?: string;
      totalCents: number;
      isManualInvoice?: boolean;
      chargeAmount: number;
      chargeIsManual?: boolean;
      billingPeriodStart?: string | null;
      billingPeriodEnd?: string | null;
    }) {
      const invoiceId = uuidv4();
      const invoiceNumber = `INV-${invoiceId.slice(0, 6)}`;
      const invoiceDate = new Date(params.invoiceDate).toISOString();

      await ctx.db('invoices').insert({
        invoice_id: invoiceId,
        tenant: ctx.tenantId,
        client_id: params.clientId ?? ctx.clientId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: invoiceDate,
        subtotal: params.totalCents,
        tax: 0,
        total_amount: params.totalCents,
        status: params.status ?? 'sent',
        currency_code: 'USD',
        is_manual: params.isManualInvoice ?? false,
        billing_period_start: params.billingPeriodStart ?? null,
        billing_period_end: params.billingPeriodEnd ?? null,
        created_at: invoiceDate,
        updated_at: invoiceDate
      });

      const chargeId = uuidv4();
      await ctx.db('invoice_charges').insert({
        item_id: chargeId,
        tenant: ctx.tenantId,
        invoice_id: invoiceId,
        service_id: serviceId,
        description: `Line for ${params.key}`,
        quantity: 1,
        unit_price: params.chargeAmount,
        total_price: params.chargeAmount,
        net_amount: params.chargeAmount,
        tax_amount: 0,
        is_manual: params.chargeIsManual ?? false,
        created_at: invoiceDate,
        updated_at: invoiceDate
      });

      const transactionId = uuidv4();
      await ctx.db('transactions').insert({
        transaction_id: transactionId,
        tenant: ctx.tenantId,
        client_id: params.clientId ?? ctx.clientId,
        invoice_id: invoiceId,
        amount: params.totalCents,
        type: params.totalCents < 0 ? 'credit_issuance' : 'invoice_generated',
        description: `Transaction for ${params.key}`,
        created_at: now.toISOString(),
        status: 'completed',
        balance_after: params.totalCents
      });

      if (['manual', 'multiPeriod', 'credit', 'zeroAmount'].includes(params.key as string)) {
        invoices[params.key] = {
          invoiceId,
          chargeId,
          transactionId
        } as SeededInvoice;
      }
    }

    await insertInvoice({
      key: 'manual',
      invoiceDate: '2025-01-05',
      isManualInvoice: true,
      chargeIsManual: true,
      totalCents: 12000,
      chargeAmount: 12000
    });

    await insertInvoice({
      key: 'multiPeriod',
      invoiceDate: '2025-01-10',
      billingPeriodStart: '2025-01-01T00:00:00.000Z',
      billingPeriodEnd: '2025-02-01T00:00:00.000Z',
      totalCents: 15000,
      chargeAmount: 15000
    });

    await insertInvoice({
      key: 'credit',
      invoiceDate: '2025-01-12',
      totalCents: -5000,
      chargeAmount: -5000
    });

    await insertInvoice({
      key: 'zeroAmount',
      invoiceDate: '2025-01-15',
      totalCents: 0,
      chargeAmount: 0
    });

    // Non matching invoice to validate filters (different client + status)
    await insertInvoice({
      key: 'excluded',
      invoiceDate: '2025-02-10',
      clientId: secondaryClientId,
      totalCents: 8000,
      chargeAmount: 8000,
      status: 'paid'
    });

    return {
      manual: invoices.manual,
      multiPeriod: invoices.multiPeriod,
      credit: invoices.credit,
      zeroAmount: invoices.zeroAmount,
      filters: {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        invoiceStatuses: ['sent'],
        clientIds: [ctx.clientId]
      }
    } satisfies SeededDataset;
  }

  it('previews invoice selection with metadata annotations', async () => {
    const seeded = await seedInvoices();

    const preview = await selector.previewInvoiceLines(seeded.filters);

    expect(preview).toHaveLength(4);
    const expectedMap = new Map<string, SeededInvoice>([
      [seeded.manual.chargeId, seeded.manual],
      [seeded.multiPeriod.chargeId, seeded.multiPeriod],
      [seeded.credit.chargeId, seeded.credit],
      [seeded.zeroAmount.chargeId, seeded.zeroAmount]
    ]);

    const chargeIds = preview.map((line) => line.chargeId);
    expect(chargeIds).toEqual(expect.arrayContaining(Array.from(expectedMap.keys())));

    const manualLine = preview.find((line) => line.chargeId === seeded.manual.chargeId)!;
    expect(manualLine.isManualInvoice).toBe(true);
    expect(manualLine.isManualCharge).toBe(true);

    const multiPeriodLine = preview.find((line) => line.chargeId === seeded.multiPeriod.chargeId)!;
    expect(multiPeriodLine.isMultiPeriod).toBe(true);
    expect(multiPeriodLine.servicePeriodStart).toBeDefined();
    expect(multiPeriodLine.servicePeriodEnd).toBeDefined();

    const creditLine = preview.find((line) => line.chargeId === seeded.credit.chargeId)!;
    expect(creditLine.isCredit).toBe(true);
    expect(creditLine.amountCents).toBeLessThan(0);

    const zeroLine = preview.find((line) => line.chargeId === seeded.zeroAmount.chargeId)!;
    expect(zeroLine.isZeroAmount).toBe(true);
    expect(zeroLine.amountCents).toBe(0);

    preview.forEach((line) => {
      const expected = expectedMap.get(line.chargeId)!;
      expect(line.transactionIds).toContain(expected.transactionId);
    });
  }, HOOK_TIMEOUT);

  it('creates a batch from filters and records transaction linkage', async () => {
    const seeded = await seedInvoices();

    const { batch, lines: previewLines } = await selector.createBatchFromFilters({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-100',
      filters: seeded.filters,
      notes: 'Integration test batch'
    });

    expect(previewLines).toHaveLength(4);

    const storedLines = await repository.listLines(batch.batch_id);
    expect(storedLines).toHaveLength(4);

    const expectedByChargeId: Record<string, SeededInvoice> = {
      [seeded.manual.chargeId]: seeded.manual,
      [seeded.multiPeriod.chargeId]: seeded.multiPeriod,
      [seeded.credit.chargeId]: seeded.credit,
      [seeded.zeroAmount.chargeId]: seeded.zeroAmount
    };

    for (const line of storedLines) {
      const expected = expectedByChargeId[line.invoice_charge_id!];
      expect(expected).toBeDefined();

      const payload = line.payload as Record<string, any> | null;
      expect(payload).toBeTruthy();
      expect(Array.isArray(payload?.transaction_ids)).toBe(true);
      expect(payload?.transaction_ids).toContain(expected.transactionId);

      if (line.invoice_charge_id === seeded.multiPeriod.chargeId) {
        expect(line.service_period_start).toBeTruthy();
        expect(line.service_period_end).toBeTruthy();
      }
    }
  }, HOOK_TIMEOUT);

  it('omits invoices already synced for the selected adapter and realm', async () => {
    const seeded = await seedInvoices();

    const now = new Date().toISOString();
    await ctx.db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant: ctx.tenantId,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: seeded.manual.invoiceId,
      external_entity_id: 'QB-INV-123',
      external_realm_id: 'realm-100',
      sync_status: 'synced',
      created_at: now,
      updated_at: now
    });

    const preview = await selector.previewInvoiceLines({
      ...seeded.filters,
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-100'
    });

    expect(preview).toHaveLength(3);
    expect(preview.map((line) => line.invoiceId)).not.toContain(seeded.manual.invoiceId);

    const { batch, lines } = await selector.createBatchFromFilters({
      adapterType: 'quickbooks_online',
      targetRealm: 'realm-100',
      filters: seeded.filters
    });

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.invoiceId)).not.toContain(seeded.manual.invoiceId);

    const storedLines = await repository.listLines(batch.batch_id);
    expect(storedLines).toHaveLength(3);
    expect(storedLines.map((line) => line.invoice_id)).not.toContain(seeded.manual.invoiceId);
  }, HOOK_TIMEOUT);
});
