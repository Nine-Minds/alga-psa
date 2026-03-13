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
  quantity: number | string;
  unit_price: number | string;
  is_discount?: boolean | null;
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

  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;

  for (const item of items) {
    const totalPrice = toNumber(item.quantity) * toNumber(item.unit_price);
    const isIncludedInTotals = !item.is_optional || item.is_selected !== false;
    const isDiscount = item.is_discount === true;
    const taxRegion = item.tax_region ?? client?.region_code ?? null;

    let netAmount = isIncludedInTotals ? totalPrice : 0;
    let taxAmount = 0;
    let taxRate = isIncludedInTotals ? toNumber(item.tax_rate) : 0;

    if (isDiscount) {
      discountTotal += isIncludedInTotals ? totalPrice : 0;
    } else {
      subtotal += isIncludedInTotals ? totalPrice : 0;

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
        total_price: totalPrice,
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
