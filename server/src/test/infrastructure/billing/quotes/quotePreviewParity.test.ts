import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TestContext } from '../../../../../test-utils/testContext';
import { setupClientTaxConfiguration } from '../../../../../test-utils/billingTestHelpers';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
import {
  recalculateQuoteFinancials,
  resolveQuoteItemTaxesIfIncluded,
} from '../../../../../../packages/billing/src/services/quoteCalculationService';
import { computeQuoteTotals } from '../../../../../../packages/core/src/lib/quoteTotals';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

/**
 * Parity: the client portal previews an optional-item selection locally with
 * `computeQuoteTotals` over rows it received at the vendor's selection. After
 * the client accepts, the server persists that selection and runs
 * `recalculateQuoteFinancials`. The two must agree.
 */
describe('Quote optional-selection preview parity', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    await context.db('quotes').where({ tenant: context.tenantId }).del();
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: false });
    // 8.875% so the per-row Math.ceil rounding is exercised.
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 8.875 });
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  type ItemSpec = {
    key: string;
    quantity: number;
    unit_price: number;
    is_optional?: boolean;
    is_recurring?: boolean;
    billing_frequency?: string;
    is_discount?: boolean;
    discount_type?: 'percentage' | 'fixed';
    discount_percentage?: number;
    unit_price_discount?: number;
    applies_to?: string;
  };

  async function buildQuote(specs: ItemSpec[]) {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Parity quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const idByKey = new Map<string, string>();
    for (const spec of specs) {
      const item = await QuoteItem.create(context.db, context.tenantId, {
        quote_id: quote.quote_id,
        description: spec.key,
        quantity: spec.quantity,
        unit_price: spec.unit_price,
        is_taxable: !spec.is_discount,
        is_optional: spec.is_optional ?? false,
        is_selected: spec.is_optional ? true : undefined,
        is_recurring: spec.is_recurring ?? false,
        billing_frequency: spec.billing_frequency,
        is_discount: spec.is_discount,
        discount_type: spec.discount_type,
        discount_percentage: spec.discount_percentage,
        applies_to_item_id: spec.applies_to ? idByKey.get(spec.applies_to) : undefined,
        created_by: context.userId,
      } as any);
      idByKey.set(spec.key, item.quote_item_id);
    }
    await recalculateQuoteFinancials(context.db, context.tenantId, quote.quote_id);
    return { quoteId: quote.quote_id, idByKey };
  }

  const loadItems = (quoteId: string) =>
    context.db('quote_items')
      .where({ tenant: context.tenantId, quote_id: quoteId })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc');

  async function expectParity(specs: ItemSpec[], deselectKeys: string[]) {
    const { quoteId, idByKey } = await buildQuote(specs);

    // What the portal receives: rows at the vendor's selection + resolved tax.
    const rows = await loadItems(quoteId);
    const taxById = await resolveQuoteItemTaxesIfIncluded(context.db, context.tenantId, quoteId);
    const deselected = new Set(deselectKeys.map((key) => idByKey.get(key)!));

    const preview = computeQuoteTotals(
      rows.map((row: any) => ({
        ...row,
        id: row.quote_item_id,
        is_selected: row.is_optional ? !deselected.has(row.quote_item_id) : row.is_selected,
        groupKey: row.is_recurring ? (row.billing_frequency ?? 'recurring') : 'one-time',
        taxAmountIfIncluded: taxById.get(row.quote_item_id) ?? 0,
      }))
    );

    // What Accept persists: that exact selection, then the server recalculation.
    for (const id of deselected) {
      await context.db('quote_items')
        .where({ tenant: context.tenantId, quote_item_id: id })
        .update({ is_selected: false });
    }
    await recalculateQuoteFinancials(context.db, context.tenantId, quoteId);
    const persisted = await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: quoteId })
      .first();

    expect(preview.subtotal).toBe(Number(persisted.subtotal));
    expect(preview.discountTotal).toBe(Number(persisted.discount_total));
    expect(preview.tax).toBe(Number(persisted.tax));
    expect(preview.totalAmount).toBe(Number(persisted.total_amount));

    // Per-group subtotals equal the sum of persisted included base rows.
    const persistedRows = await loadItems(quoteId);
    for (const [group, figures] of preview.perGroup) {
      const expected = persistedRows
        .filter((row: any) => !row.is_discount && (!row.is_optional || row.is_selected === true))
        .filter((row: any) => (row.is_recurring ? (row.billing_frequency ?? 'recurring') : 'one-time') === group)
        .reduce((sum: number, row: any) => sum + Number(row.total_price), 0);
      expect(figures.subtotal).toBe(expected);
    }
    // Resolved discount rows match the persisted per-row discount amounts.
    for (const row of persistedRows.filter((r: any) => r.is_discount)) {
      expect(preview.discountAmountById.get(row.quote_item_id) ?? 0).toBe(Number(row.total_price));
    }
    return preview;
  }

  it('matches with no discount', async () => {
    const preview = await expectParity(
      [
        { key: 'core', quantity: 3, unit_price: 3333 },
        { key: 'opt', quantity: 1, unit_price: 1999, is_optional: true },
      ],
      ['opt']
    );
    expect(preview.tax).toBe(Math.ceil((9999 * 8.875) / 100));
  });

  it('matches with a percentage discount', async () => {
    const preview = await expectParity(
      [
        { key: 'core', quantity: 1, unit_price: 12345 },
        { key: 'opt', quantity: 2, unit_price: 777, is_optional: true },
        { key: 'pct', quantity: 1, unit_price: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 15 },
      ],
      ['opt']
    );
    expect(preview.discountTotal).toBe(Math.round((12345 * 15) / 100));
  });

  it('matches with a fixed discount', async () => {
    const preview = await expectParity(
      [
        { key: 'core', quantity: 1, unit_price: 20001 },
        { key: 'opt', quantity: 1, unit_price: 5555, is_optional: true },
        { key: 'fixed', quantity: 1, unit_price: 2500, is_discount: true, discount_type: 'fixed' },
      ],
      ['opt']
    );
    expect(preview.discountTotal).toBe(2500);
  });

  it('matches across mixed monthly and annual cadence groups', async () => {
    const preview = await expectParity(
      [
        { key: 'monthly', quantity: 1, unit_price: 10001, is_recurring: true, billing_frequency: 'monthly' },
        { key: 'annual', quantity: 1, unit_price: 15901, is_recurring: true, billing_frequency: 'annual' },
        { key: 'monthly-opt', quantity: 1, unit_price: 4001, is_recurring: true, billing_frequency: 'monthly', is_optional: true },
        { key: 'annual-opt', quantity: 1, unit_price: 5003, is_recurring: true, billing_frequency: 'annual', is_optional: true },
        { key: 'onetime', quantity: 1, unit_price: 50007 },
        { key: 'pct', quantity: 1, unit_price: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
      ],
      ['annual-opt']
    );
    expect(preview.discountTotal).toBeGreaterThan(0);
    expect(Array.from(preview.perGroup.keys()).sort()).toEqual(['annual', 'monthly', 'one-time']);
  });

  // Verify-first (alga0002270): the "client cannot re-include a line" report.
  // The pre-change per-toggle path wrote is_selected and ran this recalculation;
  // deselect then reselect must restore the original rows and totals.
  it('re-including a deselected optional line restores is_selected and totals', async () => {
    const { quoteId, idByKey } = await buildQuote([
      { key: 'core', quantity: 1, unit_price: 20001 },
      { key: 'opt', quantity: 1, unit_price: 5555, is_optional: true },
    ]);
    const optionalId = idByKey.get('opt')!;
    const snapshot = async () => ({
      quote: await context.db('quotes').where({ tenant: context.tenantId, quote_id: quoteId })
        .first('subtotal', 'discount_total', 'tax', 'total_amount'),
      selected: (await context.db('quote_items')
        .where({ tenant: context.tenantId, quote_item_id: optionalId }).first('is_selected')).is_selected,
    });
    const before = await snapshot();
    for (const isSelected of [false, true]) {
      await context.db('quote_items')
        .where({ tenant: context.tenantId, quote_item_id: optionalId })
        .update({ is_selected: isSelected });
      await recalculateQuoteFinancials(context.db, context.tenantId, quoteId);
      if (!isSelected) {
        expect(Number((await snapshot()).quote.subtotal)).toBe(20001);
      }
    }
    expect(await snapshot()).toEqual(before);
    expect(before.selected).toBe(true);
  });
});
