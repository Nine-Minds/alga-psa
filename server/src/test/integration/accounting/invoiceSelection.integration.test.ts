import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';
import { createClient } from '../../../../test-utils/testDataFactory';

import {
  AccountingExportInvoiceSelector,
  type InvoiceSelectionFilters,
  AccountingExportRepository,
  AccountingExportService
} from '@alga-psa/billing/services';
import Invoice from '@alga-psa/billing/models/invoice';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

function toDateOnly(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return null;
}

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
        'invoice_charge_details',
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
    await ctx.db('invoice_charge_details').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    if (await ctx.db.schema.hasTable('companies')) {
      await ctx.db('companies').where({ tenant: ctx.tenantId }).del();
    }

    selector = new AccountingExportInvoiceSelector(ctx.db, ctx.tenantId);
    repository = new AccountingExportRepository(ctx.db, ctx.tenantId);

    const dbModule = await import('server/src/lib/db');
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });
    vi.spyOn(AccountingExportService, 'createForTenant').mockResolvedValue(
      new AccountingExportService(repository, {} as any)
    );
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
      detailServicePeriodStart?: string | null;
      detailServicePeriodEnd?: string | null;
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

      if (params.detailServicePeriodStart || params.detailServicePeriodEnd) {
        await ctx.db('invoice_charge_details').insert({
          item_detail_id: uuidv4(),
          item_id: chargeId,
          tenant: ctx.tenantId,
          service_id: serviceId,
          config_id: uuidv4(),
          quantity: 1,
          rate: params.chargeAmount,
          service_period_start: params.detailServicePeriodStart ?? null,
          service_period_end: params.detailServicePeriodEnd ?? null,
          billing_timing: 'arrears',
          created_at: invoiceDate,
          updated_at: invoiceDate
        });
      }

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
      billingPeriodStart: null,
      billingPeriodEnd: null,
      detailServicePeriodStart: '2025-01-01T00:00:00.000Z',
      detailServicePeriodEnd: '2025-02-01T00:00:00.000Z',
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
    expect(manualLine.servicePeriodSource).toBe('financial_document_fallback');

    const multiPeriodLine = preview.find((line) => line.chargeId === seeded.multiPeriod.chargeId)!;
    expect(multiPeriodLine.isMultiPeriod).toBe(true);
    expect(multiPeriodLine.servicePeriodStart).toBe('2025-01-01T00:00:00.000Z');
    expect(multiPeriodLine.servicePeriodEnd).toBe('2025-02-01T00:00:00.000Z');
    expect(multiPeriodLine.servicePeriodSource).toBe('canonical_detail_periods');

    const creditLine = preview.find((line) => line.chargeId === seeded.credit.chargeId)!;
    expect(creditLine.isCredit).toBe(true);
    expect(creditLine.amountCents).toBeLessThan(0);
    expect(creditLine.servicePeriodSource).toBe('financial_document_fallback');

    const zeroLine = preview.find((line) => line.chargeId === seeded.zeroAmount.chargeId)!;
    expect(zeroLine.isZeroAmount).toBe(true);
    expect(zeroLine.amountCents).toBe(0);
    expect(zeroLine.servicePeriodSource).toBe('financial_document_fallback');

    preview.forEach((line) => {
      const expected = expectedMap.get(line.chargeId)!;
      expect(line.transactionIds).toContain(expected.transactionId);
    });
  }, HOOK_TIMEOUT);

  it('T251: preview selection prefers canonical detail periods over invoice header periods when both exist', async () => {
    const serviceId = await createTestService(ctx, {
      service_name: 'Detail Beats Header Service',
      billing_method: 'fixed',
      default_rate: 7500,
      unit_of_measure: 'device',
      description: 'Recurring service period validation'
    });

    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    const transactionId = uuidv4();
    const invoiceDate = '2025-02-10T00:00:00.000Z';

    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: 'INV-DETAIL-HEADER',
      invoice_date: invoiceDate,
      due_date: invoiceDate,
      subtotal: 15000,
      tax: 0,
      total_amount: 15000,
      status: 'sent',
      currency_code: 'USD',
      is_manual: false,
      billing_period_start: '2025-03-01T00:00:00.000Z',
      billing_period_end: '2025-04-01T00:00:00.000Z',
      created_at: invoiceDate,
      updated_at: invoiceDate
    });

    await ctx.db('invoice_charges').insert({
      item_id: chargeId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      service_id: serviceId,
      description: 'Canonical detail-backed recurring charge',
      quantity: 1,
      unit_price: 15000,
      total_price: 15000,
      net_amount: 15000,
      tax_amount: 0,
      is_manual: false,
      created_at: invoiceDate,
      updated_at: invoiceDate
    });

    await ctx.db('invoice_charge_details').insert([
      {
        item_detail_id: uuidv4(),
        item_id: chargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: uuidv4(),
        quantity: 1,
        rate: 7500,
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'advance',
        created_at: invoiceDate,
        updated_at: invoiceDate
      },
      {
        item_detail_id: uuidv4(),
        item_id: chargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: uuidv4(),
        quantity: 1,
        rate: 7500,
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'advance',
        created_at: invoiceDate,
        updated_at: invoiceDate
      }
    ]);

    await ctx.db('transactions').insert({
      transaction_id: transactionId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_id: invoiceId,
      amount: 15000,
      type: 'invoice_generated',
      description: 'Transaction for canonical detail-backed recurring charge',
      created_at: invoiceDate,
      status: 'completed',
      balance_after: 15000
    });

    const preview = await selector.previewInvoiceLines({
      startDate: '2025-02-01',
      endDate: '2025-02-28',
      invoiceStatuses: ['sent'],
      clientIds: [ctx.clientId]
    });

    const line = preview.find((previewLine) => previewLine.chargeId === chargeId);
    expect(line).toMatchObject({
      invoiceId,
      servicePeriodStart: '2025-01-01T00:00:00.000Z',
      servicePeriodEnd: '2025-03-01T00:00:00.000Z',
      servicePeriodSource: 'canonical_detail_periods',
      transactionIds: [transactionId]
    });
    expect(line?.recurringDetailPeriods).toEqual([
      {
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'advance'
      },
      {
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'advance'
      }
    ]);
  }, HOOK_TIMEOUT);

  it('T147: export preview remains stable when one invoice contains client- and contract-cadence recurring detail rows', async () => {
    const serviceId = await createTestService(ctx, {
      service_name: 'Mixed Cadence Export Service',
      billing_method: 'fixed',
      default_rate: 10000,
      unit_of_measure: 'device',
      description: 'Mixed cadence export validation'
    });

    const invoiceId = uuidv4();
    const clientChargeId = uuidv4();
    const contractChargeId = uuidv4();
    const transactionId = uuidv4();
    const invoiceDate = '2025-02-10T00:00:00.000Z';

    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: 'INV-MIXED-CADENCE',
      invoice_date: invoiceDate,
      due_date: invoiceDate,
      subtotal: 22000,
      tax: 0,
      total_amount: 22000,
      status: 'sent',
      currency_code: 'USD',
      is_manual: false,
      billing_period_start: '2025-02-01T00:00:00.000Z',
      billing_period_end: '2025-03-01T00:00:00.000Z',
      created_at: invoiceDate,
      updated_at: invoiceDate
    });

    await ctx.db('invoice_charges').insert([
      {
        item_id: clientChargeId,
        tenant: ctx.tenantId,
        invoice_id: invoiceId,
        service_id: serviceId,
        description: 'Client cadence recurring charge',
        quantity: 1,
        unit_price: 12000,
        total_price: 12000,
        net_amount: 12000,
        tax_amount: 0,
        is_manual: false,
        created_at: invoiceDate,
        updated_at: invoiceDate
      },
      {
        item_id: contractChargeId,
        tenant: ctx.tenantId,
        invoice_id: invoiceId,
        service_id: serviceId,
        description: 'Contract cadence recurring charge',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000,
        net_amount: 10000,
        tax_amount: 0,
        is_manual: false,
        created_at: invoiceDate,
        updated_at: invoiceDate
      }
    ]);

    await ctx.db('invoice_charge_details').insert([
      {
        item_detail_id: uuidv4(),
        item_id: clientChargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: uuidv4(),
        quantity: 1,
        rate: 12000,
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'advance',
        created_at: invoiceDate,
        updated_at: invoiceDate
      },
      {
        item_detail_id: uuidv4(),
        item_id: contractChargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: uuidv4(),
        quantity: 1,
        rate: 10000,
        service_period_start: '2025-02-08T00:00:00.000Z',
        service_period_end: '2025-03-08T00:00:00.000Z',
        billing_timing: 'advance',
        created_at: invoiceDate,
        updated_at: invoiceDate
      }
    ]);

    await ctx.db('transactions').insert({
      transaction_id: transactionId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_id: invoiceId,
      amount: 22000,
      type: 'invoice_generated',
      description: 'Transaction for mixed cadence export invoice',
      created_at: invoiceDate,
      status: 'completed',
      balance_after: 22000
    });

    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'xero',
      filters: {
        startDate: '2025-02-01',
        endDate: '2025-02-28',
        invoiceStatuses: ['sent'],
        clientIds: [ctx.clientId]
      },
      notes: 'Mixed cadence export batch'
    });

    const storedLines = await repository.listLines(batch.batch_id);
    const invoiceLines = storedLines.filter((line) => line.invoice_id === invoiceId);
    expect(invoiceLines).toHaveLength(2);

    const lineByChargeId = new Map(invoiceLines.map((line) => [line.invoice_charge_id, line]));
    expect(lineByChargeId.get(clientChargeId)).toMatchObject({
      service_period_start: '2025-02-01T00:00:00.000Z',
      service_period_end: '2025-03-01T00:00:00.000Z',
      payload: {
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [
          {
            service_period_start: '2025-02-01T00:00:00.000Z',
            service_period_end: '2025-03-01T00:00:00.000Z',
            billing_timing: 'advance'
          }
        ],
        transaction_ids: [transactionId]
      }
    });
    expect(lineByChargeId.get(contractChargeId)).toMatchObject({
      service_period_start: '2025-02-08T00:00:00.000Z',
      service_period_end: '2025-03-08T00:00:00.000Z',
      payload: {
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [
          {
            service_period_start: '2025-02-08T00:00:00.000Z',
            service_period_end: '2025-03-08T00:00:00.000Z',
            billing_timing: 'advance'
          }
        ],
        transaction_ids: [transactionId]
      }
    });
  }, HOOK_TIMEOUT);

  it('T278: DB-backed sanity: mixed cadence-owner invoices remain stable across export and portal readers when historical and canonical invoices coexist', async () => {
    const serviceId = await createTestService(ctx, {
      service_name: 'Coexistence Export Portal Service',
      billing_method: 'fixed',
      default_rate: 11000,
      unit_of_measure: 'device',
      description: 'Historical and canonical coexistence validation'
    });

    const historicalInvoiceId = uuidv4();
    const canonicalInvoiceId = uuidv4();
    const historicalChargeId = uuidv4();
    const clientChargeId = uuidv4();
    const contractChargeId = uuidv4();
    const historicalTransactionId = uuidv4();
    const canonicalTransactionId = uuidv4();
    const historicalInvoiceDate = '2025-01-20T00:00:00.000Z';
    const canonicalInvoiceDate = '2025-02-20T00:00:00.000Z';

    await ctx.db('invoices').insert([
      {
        invoice_id: historicalInvoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: 'INV-HIST-COEXIST',
        invoice_date: historicalInvoiceDate,
        due_date: historicalInvoiceDate,
        subtotal: 5000,
        tax: 0,
        total_amount: 5000,
        status: 'sent',
        currency_code: 'USD',
        is_manual: false,
        billing_period_start: '2025-01-01T00:00:00.000Z',
        billing_period_end: '2025-02-01T00:00:00.000Z',
        created_at: historicalInvoiceDate,
        updated_at: historicalInvoiceDate
      },
      {
        invoice_id: canonicalInvoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: 'INV-CANON-COEXIST',
        invoice_date: canonicalInvoiceDate,
        due_date: canonicalInvoiceDate,
        subtotal: 22000,
        tax: 0,
        total_amount: 22000,
        status: 'sent',
        currency_code: 'USD',
        is_manual: false,
        billing_period_start: '2025-02-01T00:00:00.000Z',
        billing_period_end: '2025-03-01T00:00:00.000Z',
        created_at: canonicalInvoiceDate,
        updated_at: canonicalInvoiceDate
      }
    ]);

    await ctx.db('invoice_charges').insert([
      {
        item_id: historicalChargeId,
        tenant: ctx.tenantId,
        invoice_id: historicalInvoiceId,
        service_id: serviceId,
        description: 'Historical flat recurring line',
        quantity: 1,
        unit_price: 5000,
        total_price: 5000,
        net_amount: 5000,
        tax_amount: 0,
        is_manual: false,
        created_at: historicalInvoiceDate,
        updated_at: historicalInvoiceDate
      },
      {
        item_id: clientChargeId,
        tenant: ctx.tenantId,
        invoice_id: canonicalInvoiceId,
        service_id: serviceId,
        description: 'Client cadence recurring line',
        quantity: 1,
        unit_price: 12000,
        total_price: 12000,
        net_amount: 12000,
        tax_amount: 0,
        is_manual: false,
        created_at: canonicalInvoiceDate,
        updated_at: canonicalInvoiceDate
      },
      {
        item_id: contractChargeId,
        tenant: ctx.tenantId,
        invoice_id: canonicalInvoiceId,
        service_id: serviceId,
        description: 'Contract cadence recurring line',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000,
        net_amount: 10000,
        tax_amount: 0,
        is_manual: false,
        created_at: canonicalInvoiceDate,
        updated_at: canonicalInvoiceDate
      }
    ]);

    await ctx.db('invoice_charge_details').insert([
      {
        item_detail_id: uuidv4(),
        item_id: clientChargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: uuidv4(),
        quantity: 1,
        rate: 12000,
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'advance',
        created_at: canonicalInvoiceDate,
        updated_at: canonicalInvoiceDate
      },
      {
        item_detail_id: uuidv4(),
        item_id: contractChargeId,
        tenant: ctx.tenantId,
        service_id: serviceId,
        config_id: uuidv4(),
        quantity: 1,
        rate: 10000,
        service_period_start: '2025-02-08T00:00:00.000Z',
        service_period_end: '2025-03-08T00:00:00.000Z',
        billing_timing: 'advance',
        created_at: canonicalInvoiceDate,
        updated_at: canonicalInvoiceDate
      }
    ]);

    await ctx.db('transactions').insert([
      {
        transaction_id: historicalTransactionId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_id: historicalInvoiceId,
        amount: 5000,
        type: 'invoice_generated',
        description: 'Transaction for historical coexistence invoice',
        created_at: historicalInvoiceDate,
        status: 'completed',
        balance_after: 5000
      },
      {
        transaction_id: canonicalTransactionId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_id: canonicalInvoiceId,
        amount: 22000,
        type: 'invoice_generated',
        description: 'Transaction for canonical coexistence invoice',
        created_at: canonicalInvoiceDate,
        status: 'completed',
        balance_after: 22000
      }
    ]);

    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'xero',
      filters: {
        startDate: '2025-01-01',
        endDate: '2025-02-28',
        invoiceStatuses: ['sent'],
        clientIds: [ctx.clientId]
      },
      notes: 'Historical and canonical coexistence batch'
    });

    const storedLines = await repository.listLines(batch.batch_id);
    expect(storedLines).toHaveLength(3);

    const historicalExportLine = storedLines.find((line) => line.invoice_charge_id === historicalChargeId);
    expect(historicalExportLine).toMatchObject({
      invoice_id: historicalInvoiceId,
      service_period_start: null,
      service_period_end: null,
      payload: {
        invoice_number: 'INV-HIST-COEXIST',
        service_period_source: 'financial_document_fallback',
        recurring_detail_periods: null,
        transaction_ids: [historicalTransactionId]
      }
    });

    const clientExportLine = storedLines.find((line) => line.invoice_charge_id === clientChargeId);
    expect(clientExportLine).toMatchObject({
      invoice_id: canonicalInvoiceId,
      service_period_start: '2025-02-01T00:00:00.000Z',
      service_period_end: '2025-03-01T00:00:00.000Z',
      payload: {
        invoice_number: 'INV-CANON-COEXIST',
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [
          {
            service_period_start: '2025-02-01T00:00:00.000Z',
            service_period_end: '2025-03-01T00:00:00.000Z',
            billing_timing: 'advance'
          }
        ],
        transaction_ids: [canonicalTransactionId]
      }
    });

    const contractExportLine = storedLines.find((line) => line.invoice_charge_id === contractChargeId);
    expect(contractExportLine).toMatchObject({
      invoice_id: canonicalInvoiceId,
      service_period_start: '2025-02-08T00:00:00.000Z',
      service_period_end: '2025-03-08T00:00:00.000Z',
      payload: {
        invoice_number: 'INV-CANON-COEXIST',
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [
          {
            service_period_start: '2025-02-08T00:00:00.000Z',
            service_period_end: '2025-03-08T00:00:00.000Z',
            billing_timing: 'advance'
          }
        ],
        transaction_ids: [canonicalTransactionId]
      }
    });

    const historicalPortalInvoice = await Invoice.getFullInvoiceById(ctx.db, ctx.tenantId, historicalInvoiceId);
    const canonicalPortalInvoice = await Invoice.getFullInvoiceById(ctx.db, ctx.tenantId, canonicalInvoiceId);

    expect(historicalPortalInvoice?.invoice_charges).toHaveLength(1);
    expect(historicalPortalInvoice?.invoice_charges?.[0]).toMatchObject({
      item_id: historicalChargeId,
      description: 'Historical flat recurring line'
    });
    expect(historicalPortalInvoice?.invoice_charges?.[0]).not.toHaveProperty('recurring_detail_periods');
    expect(historicalPortalInvoice?.invoice_charges?.[0]).not.toHaveProperty('recurring_projection');

    expect(canonicalPortalInvoice?.invoice_charges).toHaveLength(2);
    const canonicalByDescription = new Map(
      canonicalPortalInvoice?.invoice_charges?.map((charge) => [charge.description, charge]) ?? []
    );

    expect(canonicalByDescription.get('Client cadence recurring line')).toMatchObject({
      item_id: clientChargeId,
      billing_timing: 'advance'
    });
    expect(
      toDateOnly(canonicalByDescription.get('Client cadence recurring line')?.service_period_start)
    ).toBe('2025-02-01');
    expect(
      toDateOnly(canonicalByDescription.get('Client cadence recurring line')?.service_period_end)
    ).toBe('2025-03-01');
    expect(canonicalByDescription.get('Client cadence recurring line')).not.toHaveProperty('recurring_projection');
    expect(
      canonicalByDescription.get('Client cadence recurring line')?.recurring_detail_periods?.map((period) => ({
        service_period_start: toDateOnly(period.service_period_start),
        service_period_end: toDateOnly(period.service_period_end),
        billing_timing: period.billing_timing
      }))
    ).toEqual([
      {
        service_period_start: '2025-02-01',
        service_period_end: '2025-03-01',
        billing_timing: 'advance'
      }
    ]);

    expect(canonicalByDescription.get('Contract cadence recurring line')).toMatchObject({
      item_id: contractChargeId,
      billing_timing: 'advance'
    });
    expect(
      toDateOnly(canonicalByDescription.get('Contract cadence recurring line')?.service_period_start)
    ).toBe('2025-02-08');
    expect(
      toDateOnly(canonicalByDescription.get('Contract cadence recurring line')?.service_period_end)
    ).toBe('2025-03-08');
    expect(canonicalByDescription.get('Contract cadence recurring line')).not.toHaveProperty('recurring_projection');
    expect(
      canonicalByDescription.get('Contract cadence recurring line')?.recurring_detail_periods?.map((period) => ({
        service_period_start: toDateOnly(period.service_period_start),
        service_period_end: toDateOnly(period.service_period_end),
        billing_timing: period.billing_timing
      }))
    ).toEqual([
      {
        service_period_start: '2025-02-08',
        service_period_end: '2025-03-08',
        billing_timing: 'advance'
      }
    ]);
  }, HOOK_TIMEOUT);

  it('T275: createBatchFromFilters preserves canonical recurring detail periods through export preview persistence', async () => {
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
        expect(line.service_period_start).toBe('2025-01-01T00:00:00.000Z');
        expect(line.service_period_end).toBe('2025-02-01T00:00:00.000Z');
        expect(payload?.service_period_source).toBe('canonical_detail_periods');
        expect(payload?.recurring_detail_periods).toEqual([
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'arrears'
          }
        ]);
      }

      if (line.invoice_charge_id === seeded.manual.chargeId) {
        expect(line.service_period_start).toBeNull();
        expect(line.service_period_end).toBeNull();
        expect(payload?.service_period_source).toBe('financial_document_fallback');
        expect(payload?.recurring_detail_periods).toBeNull();
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
