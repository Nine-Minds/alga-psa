import type { Knex } from 'knex';
import { runWithTenant } from '@alga-psa/db';
import { TaxService } from './taxService';

interface QuoteCalculationContext {
  quote_id: string;
  client_id?: string | null;
  quote_date?: string | null;
  currency_code?: string | null;
  tax_source?: 'internal' | 'external' | 'pending_external' | null;
}

interface QuoteItemRow {
  quote_item_id: string;
  service_id?: string | null;
  quantity: number | string;
  unit_price: number | string;
  is_discount?: boolean | null;
  discount_type?: 'percentage' | 'fixed' | null;
  discount_percentage?: number | string | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
  is_optional?: boolean | null;
  is_selected?: boolean | null;
  is_taxable?: boolean | null;
  tax_region?: string | null;
  tax_rate?: number | string | null;
  total_price?: number | string | null;
  net_amount?: number | string | null;
  tax_amount?: number | string | null;
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function toQuoteDate(value?: string | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function isItemIncluded(item: QuoteItemRow): boolean {
  if (!item.is_optional) return true;
  return item.is_selected === true;
}

function calculateDiscountAmount(item: QuoteItemRow, baseAmount: number): number {
  if (item.discount_type === 'percentage') {
    return Math.round(baseAmount * (toNumber(item.discount_percentage) / 100));
  }

  // Fixed discount: the total_price represents the absolute discount amount.
  // unit_price is the per-unit discount, quantity multiplies it.
  return Math.abs(toNumber(item.quantity || 1) * toNumber(item.unit_price));
}

export async function recalculateQuoteFinancials(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<void> {
  const quote = await knexOrTrx('quotes')
    .where({ tenant, quote_id: quoteId })
    .first() as QuoteCalculationContext | undefined;

  if (!quote) {
    return;
  }

  const items = await knexOrTrx('quote_items')
    .where({ tenant, quote_id: quoteId })
    .orderBy('display_order', 'asc')
    .orderBy('created_at', 'asc') as QuoteItemRow[];

  const client = quote.client_id
    ? await knexOrTrx('clients')
        .where({ tenant, client_id: quote.client_id })
        .select('region_code')
        .first()
    : null;

  const taxService = quote.client_id ? new TaxService() : null;
  const quoteDate = toQuoteDate(quote.quote_date);
  const currencyCode = quote.currency_code ?? 'USD';
  const taxSource = quote.tax_source ?? 'internal';
  const includedBaseItems = items.filter((item) => !item.is_discount && isItemIncluded(item));
  const baseSubtotal = includedBaseItems.reduce((sum, item) => sum + (toNumber(item.quantity) * toNumber(item.unit_price)), 0);
  const baseItemTotals = new Map(includedBaseItems.map((item) => [item.quote_item_id, toNumber(item.quantity) * toNumber(item.unit_price)]));
  const baseServiceTotals = new Map<string, number>();

  for (const item of includedBaseItems) {
    if (!item.service_id) {
      continue;
    }

    baseServiceTotals.set(
      item.service_id,
      (baseServiceTotals.get(item.service_id) ?? 0) + (toNumber(item.quantity) * toNumber(item.unit_price))
    );
  }

  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;

  for (const item of items) {
    const totalPrice = toNumber(item.quantity) * toNumber(item.unit_price);
    const isIncludedInTotals = isItemIncluded(item);
    const isDiscount = item.is_discount === true;
    const taxRegion = item.tax_region ?? client?.region_code ?? null;

    const scopedBaseAmount = item.applies_to_item_id
      ? (baseItemTotals.get(item.applies_to_item_id) ?? 0)
      : item.applies_to_service_id
        ? (baseServiceTotals.get(item.applies_to_service_id) ?? 0)
        : baseSubtotal;
    const resolvedTotalPrice = isDiscount ? calculateDiscountAmount(item, scopedBaseAmount) : totalPrice;

    let netAmount = isIncludedInTotals ? resolvedTotalPrice : 0;
    let taxAmount = 0;
    let taxRate = isIncludedInTotals ? toNumber(item.tax_rate) : 0;

    if (isDiscount) {
      discountTotal += isIncludedInTotals ? resolvedTotalPrice : 0;
    } else {
      subtotal += isIncludedInTotals ? resolvedTotalPrice : 0;

      if (isIncludedInTotals && quote.client_id && taxService && taxSource === 'internal') {
        const taxResult = await runWithTenant(tenant, async () => {
          return taxService.calculateTax(
            quote.client_id!,
            netAmount,
            quoteDate,
            taxRegion ?? undefined,
            item.is_taxable !== false,
            currencyCode
          );
        });

        taxAmount = taxResult.taxAmount;
        taxRate = Math.round(Number(taxResult.taxRate ?? 0));
      } else if (taxSource !== 'internal') {
        taxAmount = 0;
        taxRate = 0;
      }

      tax += taxAmount;
    }

    await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: item.quote_item_id })
      .update({
        total_price: resolvedTotalPrice,
        net_amount: netAmount,
        tax_amount: taxAmount,
        tax_region: taxRegion,
        tax_rate: taxRate,
        updated_at: knexOrTrx.fn.now(),
      });
  }

  await knexOrTrx('quotes')
    .where({ tenant, quote_id: quoteId })
    .update({
      subtotal,
      discount_total: discountTotal,
      tax,
      total_amount: subtotal - discountTotal + tax,
      updated_at: knexOrTrx.fn.now(),
    });
}
