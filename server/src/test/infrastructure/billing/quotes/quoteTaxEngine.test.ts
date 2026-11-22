/**
 * One tax engine for quotes and invoices (alga-2026-0003321).
 *
 * DB-backed coverage for T002, T003, T005, T006, T008 and T009, plus the repair
 * round: the editor's totals come from the engine (T011), and conversion decides
 * from a fresh engine resolution on the billing and workflow paths (T012): the shared
 * engine's unresolved result and TaxService's NO_TAX_RATE, read-only settings
 * resolution, quote recalculation agreeing with invoice tax (billing and
 * workflow-worker paths), the `tax_unresolved` flag, and conversion refusal.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mockedTenantConnection = vi.hoisted(() => ({
  db: null as any,
  tenant: null as string | null,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!mockedTenantConnection.db || !mockedTenantConnection.tenant) {
        throw new Error('Mock tenant connection not initialized');
      }
      return { knex: mockedTenantConnection.db, tenant: mockedTenantConnection.tenant };
    }),
  };
});

import { TestContext } from '../../../../../test-utils/testContext';
import { ensureDefaultBillingProfile } from '../../../../../test-utils/billingProfileTestHelpers';
import { TaxService } from '../../../../../../packages/billing/src/services/taxService';
import { recalculateQuoteFinancials, resolveQuoteDraftTax } from '../../../../../../packages/billing/src/services/quoteCalculationService';
import { mapLoadedQuoteToViewModel } from '../../../../../../packages/billing/src/lib/adapters/quoteAdapters';
import { convertQuoteToDraftInvoice } from '../../../../../../packages/billing/src/services/quoteConversionService';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
import { calculateTaxForAmount } from '../../../../../../shared/billingClients/taxEngine';
import { Quote as WorkerQuote, convertQuoteToDraftInvoice as workerConvertQuoteToDraftInvoice } from '../../../../../../shared/workflow/runtime/actions/businessOperations/crmWorkerDal';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const QUOTE_DATE = '2026-03-10T00:00:00.000Z';
const RATE_START = '2025-01-01T00:00:00.000Z';

describe('One tax engine: quotes and invoices', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;
    // Quotes resolve the client's region; keep the default path in play unless a test sets one.
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: null, is_tax_exempt: false });
    await context.db('client_tax_rates').where({ tenant: context.tenantId, client_id: context.clientId }).del();
  }, 30000);

  afterEach(async () => {
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  const db = () => context.db;
  const tenant = () => context.tenantId;

  async function addRegion(code: string, name: string) {
    await db()('tax_regions')
      .insert({ tenant: tenant(), region_code: code, region_name: name, is_active: true })
      .onConflict(['tenant', 'region_code']).ignore();
  }

  async function addRate(overrides: Record<string, unknown> = {}) {
    const rateId = randomUUID();
    await db()('tax_rates').insert({
      tenant: tenant(), tax_rate_id: rateId, region_code: 'RATED', tax_percentage: 10,
      start_date: RATE_START, end_date: null, is_active: true, is_composite: false,
      currency_code: null, tax_type: 'VAT', description: 'fixture', ...overrides,
    });
    return rateId;
  }

  async function makeDefaultRate(rateId: string) {
    await db()('client_tax_rates').insert({
      tenant: tenant(), client_id: context.clientId, tax_rate_id: rateId, is_default: true,
    });
  }

  async function createQuote(items: Array<Record<string, unknown>>, status: string = 'draft') {
    const quote = await Quote.create(db(), tenant(), {
      client_id: context.clientId, title: 'Tax engine quote', quote_date: QUOTE_DATE,
      valid_until: '2026-04-10T00:00:00.000Z', subtotal: 0, discount_total: 0, tax: 0,
      total_amount: 0, currency_code: 'USD', is_template: false, created_by: context.userId,
    } as any);
    const created = [] as any[];
    for (const item of items) {
      created.push(await QuoteItem.create(db(), tenant(), {
        quote_id: quote.quote_id, description: 'Line', quantity: 1, unit_price: 10000,
        is_optional: false, is_selected: true, is_recurring: false, is_taxable: true,
        created_by: context.userId, ...item,
      } as any));
    }
    if (status !== 'draft') {
      await db()('quotes').where({ tenant: tenant(), quote_id: quote.quote_id })
        .update({ status, accepted_at: '2026-03-14T12:00:00.000Z', accepted_by: context.userId });
    }
    return { quoteId: quote.quote_id as string, items: created };
  }

  const readItem = (id: string) =>
    db()('quote_items').where({ tenant: tenant(), quote_item_id: id }).first();

  describe('T002: unresolved result and NO_TAX_RATE parity', () => {
    it('engine returns unresolved; TaxService raises NO_TAX_RATE with the same message and details', async () => {
      await addRegion('EMPTY', 'Empty region');
      const outcome = await calculateTaxForAmount(db(), tenant(), {
        clientId: context.clientId, netAmount: 10000, date: QUOTE_DATE, regionCode: 'EMPTY',
      });
      expect(outcome).toEqual({ resolved: false, reason: 'no_rate', regionCode: 'EMPTY', date: QUOTE_DATE });

      await expect(new TaxService().calculateTax(context.clientId, 10000, QUOTE_DATE, 'EMPTY'))
        .rejects.toMatchObject({
          code: 'NO_TAX_RATE',
          message: `No active tax rate(s) found for region EMPTY on date ${QUOTE_DATE}`,
          params: { region: 'EMPTY', date: QUOTE_DATE },
        });
    });
  });

  describe('T003: read-only settings, per-profile resolution', () => {
    it('inserts nothing when the client has no client_tax_settings row', async () => {
      await addRegion('RATED', 'Rated');
      await addRate({ tax_percentage: 10 });
      await db()('client_tax_settings').where({ tenant: tenant(), client_id: context.clientId }).del();
      const count = async () => Number((await db()('client_tax_settings').where({ tenant: tenant() }).count('* as n').first())!.n);
      const before = await count();

      const outcome = await calculateTaxForAmount(db(), tenant(), {
        clientId: context.clientId, netAmount: 10000, date: QUOTE_DATE, regionCode: 'RATED',
      });
      expect(outcome).toMatchObject({ resolved: true, taxAmount: 1000, taxRate: 10 });
      const viaService = await new TaxService().calculateTax(context.clientId, 10000, QUOTE_DATE, 'RATED');
      expect(viaService).toEqual({ taxAmount: 1000, taxRate: 10 });
      expect(await count()).toBe(before);
    });

    it("applies the default profile's reverse-charge setting when the client has two profiles", async () => {
      await addRegion('RATED', 'Rated');
      await addRate({ tax_percentage: 10 });
      const defaultProfileId = await ensureDefaultBillingProfile(context, context.clientId);
      const [sibling] = await db()('client_billing_profiles').insert({
        tenant: tenant(), client_id: context.clientId, name: 'Second entity', is_default: false, is_active: true,
      }).returning('billing_profile_id');
      await db()('client_tax_settings').where({ tenant: tenant(), client_id: context.clientId }).del();
      await db()('client_tax_settings').insert([
        { tenant: tenant(), client_id: context.clientId, billing_profile_id: defaultProfileId, is_reverse_charge_applicable: false },
        { tenant: tenant(), client_id: context.clientId, billing_profile_id: sibling.billing_profile_id, is_reverse_charge_applicable: true },
      ]);

      const input = { clientId: context.clientId, netAmount: 10000, date: QUOTE_DATE, regionCode: 'RATED' };
      expect(await calculateTaxForAmount(db(), tenant(), input)).toMatchObject({ taxAmount: 1000 });
      expect(await calculateTaxForAmount(db(), tenant(), { ...input, billingProfileId: sibling.billing_profile_id }))
        .toMatchObject({ taxAmount: 0 });

      // Flip: default profile reverse charge on, sibling off.
      await db()('client_tax_settings').where({ tenant: tenant(), billing_profile_id: defaultProfileId })
        .update({ is_reverse_charge_applicable: true });
      await db()('client_tax_settings').where({ tenant: tenant(), billing_profile_id: sibling.billing_profile_id })
        .update({ is_reverse_charge_applicable: false });
      expect(await calculateTaxForAmount(db(), tenant(), input)).toMatchObject({ taxAmount: 0 });
    });
  });

  describe('T005: quote recalculation agrees with invoice tax', () => {
    const invoiceTax = (net: number, region?: string) =>
      new TaxService().calculateTax(context.clientId, net, QUOTE_DATE, region);

    it('capped regional rate', async () => {
      await addRegion('CAPPED', 'Capped');
      await addRate({ region_code: 'CAPPED', tax_percentage: 10, cap_amount: 500 });
      const { quoteId, items } = await createQuote([{ tax_region: 'CAPPED' }]);
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const row = await readItem(items[0].quote_item_id);
      const expected = await invoiceTax(10000, 'CAPPED');
      expect(expected.taxAmount).toBe(500);
      expect(Number(row.tax_amount)).toBe(expected.taxAmount);
      expect(row.tax_unresolved).toBe(false);
    });

    it('bracketed default rate with a non-zero first minimum and a gap', async () => {
      await addRegion('BRKT', 'Brackets');
      const rateId = await addRate({ region_code: 'BRKT', tax_percentage: 0 });
      await makeDefaultRate(rateId);
      await db()('tax_rate_thresholds').insert([
        { tax_rate_threshold_id: randomUUID(), tax_rate_id: rateId, min_amount: 2000, max_amount: 5000, rate: 10 },
        { tax_rate_threshold_id: randomUUID(), tax_rate_id: rateId, min_amount: 8000, max_amount: null, rate: 20 },
      ]);
      const { quoteId, items } = await createQuote([{}]);
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const row = await readItem(items[0].quote_item_id);
      const expected = await invoiceTax(10000);
      expect(expected.taxAmount).toBe(700);
      expect(Number(row.tax_amount)).toBe(expected.taxAmount);
    });

    it('composite default rate mixing compound and non-compound components', async () => {
      await addRegion('COMP', 'Composite');
      const rateId = await addRate({ region_code: 'COMP', tax_percentage: 0, is_composite: true });
      await makeDefaultRate(rateId);
      const comps = [
        { rate: 5, is_compound: false, name: 'A' },
        { rate: 10, is_compound: true, name: 'B' },
        { rate: 2, is_compound: false, name: 'C' },
      ];
      for (const [index, comp] of comps.entries()) {
        const componentId = randomUUID();
        await db()('tax_components').insert({
          tenant: tenant(), tax_component_id: componentId, tax_rate_id: rateId, name: comp.name,
          rate: comp.rate, is_compound: comp.is_compound, sequence: index + 1,
        });
        await db()('composite_tax_mappings').insert({
          composite_tax_id: rateId, tax_component_id: componentId, sequence: index + 1,
        });
      }
      const { quoteId, items } = await createQuote([{}]);
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const row = await readItem(items[0].quote_item_id);
      const expected = await invoiceTax(10000);
      expect(expected.taxAmount).toBe(500 + 1050 + 200);
      expect(Number(row.tax_amount)).toBe(expected.taxAmount);
    });
  });

  describe('T006: workflow quote recalculation matches billing recalculation', () => {
    it('produces the same row and quote totals', async () => {
      await addRegion('CAPPED', 'Capped');
      await addRate({ region_code: 'CAPPED', tax_percentage: 10, cap_amount: 500 });
      await addRegion('PLAIN', 'Plain');
      await addRate({ region_code: 'PLAIN', tax_percentage: 7 });
      await addRegion('EMPTY', 'Empty');
      const { quoteId } = await createQuote([
        { tax_region: 'CAPPED' },
        { tax_region: 'PLAIN', unit_price: 12345 },
        { tax_region: 'EMPTY', unit_price: 5000 },
        { tax_region: 'PLAIN', is_optional: true, is_selected: false },
      ]);

      const snapshot = async () => ({
        quote: await db()('quotes').where({ tenant: tenant(), quote_id: quoteId })
          .first('subtotal', 'discount_total', 'tax', 'total_amount'),
        items: await db()('quote_items').where({ tenant: tenant(), quote_id: quoteId }).orderBy('display_order')
          .where({ is_optional: false })
          // A pending optional row is out of scope here: billing keeps its resolved
          // "if selected" rate, the worker (as before this change) stores 0 for it.
          .select('quote_item_id', 'net_amount', 'tax_amount', 'tax_rate', 'tax_region', 'tax_unresolved'),
      });

      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const viaBilling = await snapshot();
      await db()('quote_items').where({ tenant: tenant(), quote_id: quoteId })
        .update({ tax_amount: 0, net_amount: 0, tax_unresolved: false });
      await db()('quotes').where({ tenant: tenant(), quote_id: quoteId }).update({ tax: 0, total_amount: 0 });

      await WorkerQuote.update(db(), tenant(), quoteId, { title: 'Renamed by workflow' } as any);
      const viaWorker = await snapshot();
      expect(viaWorker).toEqual(viaBilling);
      expect(Number(viaWorker.quote.tax)).toBe(500 + Math.ceil(12345 * 0.07));
    });
  });

  describe('T008: tax_unresolved', () => {
    it('is set with 0 tax for a rate-less region, cleared once a rate exists, and returned by reads', async () => {
      await addRegion('LATER', 'Later Region');
      const { quoteId, items } = await createQuote([{ tax_region: 'LATER' }]);
      await recalculateQuoteFinancials(db(), tenant(), quoteId);

      let row = await readItem(items[0].quote_item_id);
      expect(row.tax_unresolved).toBe(true);
      expect(Number(row.tax_amount)).toBe(0);
      const listed = await QuoteItem.listByQuoteId(db(), tenant(), quoteId);
      expect(listed[0].tax_unresolved).toBe(true);
      const loaded = await Quote.getById(db(), tenant(), quoteId);
      expect(loaded!.quote_items![0].tax_unresolved).toBe(true);

      await addRate({ region_code: 'LATER', tax_percentage: 8 });
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      row = await readItem(items[0].quote_item_id);
      expect(row.tax_unresolved).toBe(false);
      expect(Number(row.tax_amount)).toBe(800);
      expect((await QuoteItem.listByQuoteId(db(), tenant(), quoteId))[0].tax_unresolved).toBe(false);
    });

    it('does not flag a non-taxable line in a rate-less region', async () => {
      await addRegion('LATER', 'Later Region');
      const { quoteId, items } = await createQuote([{ tax_region: 'LATER', is_taxable: false }]);
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      expect((await readItem(items[0].quote_item_id)).tax_unresolved).toBe(false);
    });
  });

  describe('T009: conversion is refused while an included one-time row is unresolved', () => {
    it('refuses with the NO_TAX_RATE message and creates nothing; converts once resolved', async () => {
      await addRegion('LATER', 'Later Region');
      const { quoteId } = await createQuote([{ tax_region: 'LATER' }], 'accepted');
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const invoiceCount = async () => Number((await db()('invoices').where({ tenant: tenant() }).count('* as n').first())!.n);
      const before = await invoiceCount();

      await expect(convertQuoteToDraftInvoice(db(), tenant(), quoteId)).rejects.toMatchObject({
        code: 'NO_TAX_RATE',
        message: `No active tax rate(s) found for region LATER on date ${QUOTE_DATE}`,
      });
      expect(await invoiceCount()).toBe(before);
      expect((await Quote.getById(db(), tenant(), quoteId))!.converted_invoice_id ?? null).toBeNull();

      await addRate({ region_code: 'LATER', tax_percentage: 8 });
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const result = await convertQuoteToDraftInvoice(db(), tenant(), quoteId);
      expect(result.invoice.invoice_id).toBeTruthy();
      expect(await invoiceCount()).toBe(before + 1);
    });

    it('is not blocked by an unresolved unselected optional row', async () => {
      await addRegion('LATER', 'Later Region');
      await addRegion('RATED', 'Rated');
      await addRate({ region_code: 'RATED', tax_percentage: 10 });
      const { quoteId } = await createQuote([
        { tax_region: 'RATED' },
        { tax_region: 'LATER', is_optional: true, is_selected: false },
      ], 'accepted');
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      // Even if the unselected row carries the flag, only included rows block.
      await db()('quote_items').where({ tenant: tenant(), quote_id: quoteId, is_optional: true })
        .update({ tax_unresolved: true });
      const result = await convertQuoteToDraftInvoice(db(), tenant(), quoteId);
      expect(result.invoice.invoice_id).toBeTruthy();
    });
  });

  describe('T011: the editor totals come from the engine (QTX-CAP-1)', () => {
    // Region QTX-CAP: 10%, capped at $25 per line. Lines $1,000 and $100.
    // Rate x amount arithmetic gives Tax $110 / Total $1,210; the engine gives $35 / $1,135.
    async function capQuote(extra: Array<Record<string, unknown>> = []) {
      await addRegion('QTX-CAP', 'Cap region');
      await addRate({ region_code: 'QTX-CAP', tax_percentage: 10, cap_amount: 2500 });
      return createQuote([
        { tax_region: 'QTX-CAP', unit_price: 100000, description: 'Managed service' },
        { tax_region: 'QTX-CAP', unit_price: 10000, description: 'Add-on' },
        ...extra,
      ]);
    }

    const draftInput = async (quoteId: string, quoteIdForSource: string | null = quoteId) => {
      const rows = await db()('quote_items').where({ tenant: tenant(), quote_id: quoteId }).orderBy('display_order');
      return {
        client_id: context.clientId,
        quote_id: quoteIdForSource,
        quote_date: QUOTE_DATE,
        currency_code: 'USD',
        items: rows.map((row: any) => ({
          id: row.quote_item_id,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          is_optional: row.is_optional,
          is_selected: row.is_selected,
          is_recurring: row.is_recurring,
          is_taxable: row.is_taxable,
          tax_region: row.tax_region,
          tax_rate: 10, // stale rate a browser could multiply: the engine must ignore it
        })),
      };
    };

    it('server-action figures equal recalculateQuoteFinancials: Tax $35.00, Total $1,135.00', async () => {
      const { quoteId, items } = await capQuote();
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const stored = await db()('quotes').where({ tenant: tenant(), quote_id: quoteId }).first();
      expect(Number(stored.tax)).toBe(3500);
      expect(Number(stored.total_amount)).toBe(113500);

      const draft = await resolveQuoteDraftTax(db(), tenant(), await draftInput(quoteId));
      expect(draft.totals).toMatchObject({
        subtotal: 110000, discount_total: 0, tax: 3500, total_amount: 113500,
      });
      expect(draft.totals.tax).toBe(Number(stored.tax));
      expect(draft.totals.total_amount).toBe(Number(stored.total_amount));
      expect(draft.rows[items[0].quote_item_id]).toMatchObject({ taxAmount: 2500, taxUnresolved: false });
      expect(draft.rows[items[1].quote_item_id]).toMatchObject({ taxAmount: 1000, taxUnresolved: false });
    });

    it('also answers for an unsaved draft (no quote_id) before anything is stored', async () => {
      const { quoteId } = await capQuote();
      const draft = await resolveQuoteDraftTax(db(), tenant(), await draftInput(quoteId, null));
      expect(draft.totals.tax).toBe(3500);
      expect(draft.totals.total_amount).toBe(113500);
    });

    it('writes nothing', async () => {
      const { quoteId } = await capQuote();
      const snapshot = async () => ({
        quote: await db()('quotes').where({ tenant: tenant(), quote_id: quoteId }).first(),
        items: await db()('quote_items').where({ tenant: tenant(), quote_id: quoteId }).orderBy('display_order'),
        settings: Number((await db()('client_tax_settings').where({ tenant: tenant() }).count('* as n').first())!.n),
      });
      const before = await snapshot();
      await resolveQuoteDraftTax(db(), tenant(), await draftInput(quoteId));
      expect(await snapshot()).toEqual(before);
    });

    it('"if selected" for a pending optional row is the engine figure, on the draft and in the document view model', async () => {
      // $500 optional add-on: 10% is $50, capped to $25.
      const { quoteId, items } = await capQuote([
        { tax_region: 'QTX-CAP', unit_price: 50000, is_optional: true, is_selected: false, description: 'Optional add-on' },
      ]);
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      const pendingId = items[2].quote_item_id;

      const draft = await resolveQuoteDraftTax(db(), tenant(), await draftInput(quoteId));
      expect(draft.rows[pendingId].taxAmount).toBe(2500);
      expect(draft.totals).toMatchObject({
        tax: 3500, total_amount: 113500, optional_subtotal: 50000, optional_tax: 2500, optional_total: 52500,
      });

      const loaded = await Quote.getById(db(), tenant(), quoteId);
      const viewModel = await mapLoadedQuoteToViewModel(db(), tenant(), loaded as any);
      expect(viewModel.tax).toBe(3500);
      expect(viewModel.total_amount).toBe(113500);
      expect(viewModel.optional_tax).toBe(draft.totals.optional_tax);
      expect(viewModel.optional_total).toBe(draft.totals.optional_total);
    });

    it('a draft line in a region with no rate is unresolved, not a computed $0', async () => {
      const { quoteId, items } = await capQuote([{ tax_region: 'QTX-NONE', unit_price: 20000 }]);
      await addRegion('QTX-NONE', 'No rate region');
      const draft = await resolveQuoteDraftTax(db(), tenant(), await draftInput(quoteId));
      expect(draft.rows[items[2].quote_item_id]).toMatchObject({ taxAmount: 0, taxUnresolved: true, taxRegion: 'QTX-NONE' });
      expect(draft.rows[items[0].quote_item_id].taxUnresolved).toBe(false);
    });
  });

  describe.each([
    ['billing conversion', (quoteId: string) => convertQuoteToDraftInvoice(db(), tenant(), quoteId), false],
    ['workflow worker conversion', (quoteId: string) => workerConvertQuoteToDraftInvoice(db(), tenant(), quoteId), true],
  ] as Array<[string, (quoteId: string) => Promise<any>, boolean]>)('T012: %s decides from a fresh engine resolution', (_name, convert) => {
    const invoiceCount = async () => Number((await db()('invoices').where({ tenant: tenant() }).count('* as n').first())!.n);

    it('(a) a stale tax_unresolved=true flag does not block once a rate exists, and the invoice carries engine tax', async () => {
      await addRegion('QTX-NONE', 'Later rated region');
      const { quoteId, items } = await createQuote([{ tax_region: 'QTX-NONE', unit_price: 10000 }], 'accepted');
      await recalculateQuoteFinancials(db(), tenant(), quoteId);
      expect((await readItem(items[0].quote_item_id)).tax_unresolved).toBe(true);

      // A rate is added afterwards; nothing recalculates the quote, so the flag
      // and the stored 0 tax are stale.
      await addRate({ region_code: 'QTX-NONE', tax_percentage: 8 });
      expect((await readItem(items[0].quote_item_id)).tax_unresolved).toBe(true);
      const before = await invoiceCount();

      const result = await convert(quoteId);
      expect(await invoiceCount()).toBe(before + 1);
      const invoiceId = result.invoice.invoice_id;
      const charges = await db()('invoice_charges').where({ tenant: tenant(), invoice_id: invoiceId });
      expect(charges).toHaveLength(1);
      expect(Number(charges[0].net_amount)).toBe(10000);
      expect(Number(charges[0].tax_amount)).toBe(800);
      const invoice = await db()('invoices').where({ tenant: tenant(), invoice_id: invoiceId }).first();
      expect(Number(invoice.tax)).toBe(800);
      expect(Number(invoice.total_amount)).toBe(10800);
    });

    it('(b) a quote saved before the flag existed (flag false) in a rate-less region is refused with NO_TAX_RATE and no invoice', async () => {
      await addRegion('QTX-NONE', 'No rate region');
      // Saved before the deploy: the column took its default (false) and the row's tax is the stored 0.
      const { quoteId, items } = await createQuote([{ tax_region: 'QTX-NONE', unit_price: 10000 }], 'accepted');
      await db()('quote_items').where({ tenant: tenant(), quote_id: quoteId }).update({ tax_unresolved: false, tax_amount: 0 });
      expect((await readItem(items[0].quote_item_id)).tax_unresolved).toBe(false);
      const before = await invoiceCount();

      await expect(convert(quoteId)).rejects.toMatchObject({
        code: 'NO_TAX_RATE',
        message: `No active tax rate(s) found for region QTX-NONE on date ${QUOTE_DATE}`,
      });
      expect(await invoiceCount()).toBe(before);
      expect((await Quote.getById(db(), tenant(), quoteId))!.converted_invoice_id ?? null).toBeNull();
    });
  });
});
