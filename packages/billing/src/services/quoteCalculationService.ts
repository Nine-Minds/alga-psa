import type { Knex } from 'knex';

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
  location_id?: string | null;
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

function isDateApplicable(row: { start_date?: string | Date | null; end_date?: string | Date | null }, date: string): boolean {
  const currentDate = new Date(date);
  if (row.start_date && new Date(row.start_date) > currentDate) return false;
  if (row.end_date && new Date(row.end_date) < currentDate) return false;
  return true;
}

function calculateThresholdBasedTax(
  thresholds: Array<{ min_amount: number | string; max_amount?: number | string | null; rate: number | string }>,
  netAmount: number
): { taxAmount: number; taxRate: number } {
  let taxAmount = 0;
  let remainingAmount = netAmount;

  for (const threshold of thresholds) {
    if (remainingAmount <= 0) break;

    const minAmount = toNumber(threshold.min_amount);
    const maxAmount = threshold.max_amount == null ? null : toNumber(threshold.max_amount);
    const taxableAmount = maxAmount == null
      ? remainingAmount
      : Math.min(remainingAmount, Math.max(maxAmount - minAmount, 0));

    taxAmount += Math.ceil((taxableAmount * toNumber(threshold.rate)) / 100);
    remainingAmount -= taxableAmount;
  }

  return {
    taxAmount,
    taxRate: netAmount > 0 ? (taxAmount / netAmount) * 100 : 0,
  };
}

async function getApplicableTaxHoliday(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  date: string
): Promise<Record<string, unknown> | undefined> {
  const currentDate = new Date(date);
  const holidays = await knexOrTrx('tax_holidays')
    .where({ tenant, tax_rate_id: taxRateId })
    .orderBy('start_date');

  return holidays.find((holiday) =>
    new Date(holiday.start_date) <= currentDate && new Date(holiday.end_date) >= currentDate
  );
}

async function calculateComponentTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  component: Record<string, unknown>,
  amount: number,
  date: string
): Promise<number> {
  const holiday = await getApplicableTaxHoliday(knexOrTrx, tenant, String(component.tax_rate_id), date);
  if (holiday) return 0;
  return Math.ceil((amount * toNumber(component.rate)) / 100);
}

async function calculateTaxWithConnection(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  netAmount: number,
  date: string,
  regionCode: string | undefined,
  isTaxable: boolean,
  currencyCode?: string | null
): Promise<{ taxAmount: number; taxRate: number }> {
  const client = await knexOrTrx('clients')
    .where({ tenant, client_id: clientId })
    .select('is_tax_exempt')
    .first();

  if (!client) {
    throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
  }

  if (client.is_tax_exempt || !isTaxable) {
    return { taxAmount: 0, taxRate: 0 };
  }

  const taxSettings = await knexOrTrx('client_tax_settings')
    .where({ tenant, client_id: clientId })
    .select('is_reverse_charge_applicable')
    .first();
  if (taxSettings?.is_reverse_charge_applicable) {
    return { taxAmount: 0, taxRate: 0 };
  }

  if (regionCode) {
    const applicableRates = await knexOrTrx('tax_rates')
      .where({ tenant, region_code: regionCode, is_active: true })
      .andWhere('start_date', '<=', date)
      .andWhere(function dateRange() {
        this.whereNull('end_date').orWhere('end_date', '>', date);
      })
      .andWhere(function currencyRange() {
        this.whereNull('currency_code');
        if (currencyCode) this.orWhere('currency_code', currencyCode);
      })
      .select('tax_percentage');

    const combinedTaxRate = applicableRates.reduce((sum, rate) => sum + toNumber(rate.tax_percentage), 0);
    return {
      taxAmount: netAmount > 0 ? Math.ceil((netAmount * combinedTaxRate) / 100) : 0,
      taxRate: combinedTaxRate,
    };
  }

  const defaultRateAssoc = await knexOrTrx('client_tax_rates')
    .where({ tenant, client_id: clientId, is_default: true })
    .whereNull('location_id')
    .select('tax_rate_id')
    .first();

  if (!defaultRateAssoc) {
    return { taxAmount: 0, taxRate: 0 };
  }

  const taxRate = await knexOrTrx('tax_rates')
    .where({ tenant, tax_rate_id: defaultRateAssoc.tax_rate_id, is_active: true })
    .andWhere('start_date', '<=', date)
    .andWhere(function dateRange() {
      this.whereNull('end_date').orWhere('end_date', '>', date);
    })
    .andWhere(function currencyRange() {
      this.whereNull('currency_code');
      if (currencyCode) this.orWhere('currency_code', currencyCode);
    })
    .first();

  if (!taxRate) {
    return { taxAmount: 0, taxRate: 0 };
  }

  if (taxRate.is_composite) {
    const components = await knexOrTrx('tax_components')
      .join('composite_tax_mappings', function joinMappings() {
        this.on('tax_components.tax_component_id', '=', 'composite_tax_mappings.tax_component_id')
          .andOn('tax_components.tenant', '=', 'composite_tax_mappings.tenant');
      })
      .where({
        'tax_components.tenant': tenant,
        'composite_tax_mappings.composite_tax_id': taxRate.tax_rate_id,
      })
      .orderBy('composite_tax_mappings.sequence')
      .select('tax_components.*');

    let totalTaxAmount = 0;
    let taxableAmount = netAmount;
    for (const component of components) {
      if (!isDateApplicable(component, date)) continue;
      const componentTax = await calculateComponentTax(knexOrTrx, tenant, component, taxableAmount, date);
      totalTaxAmount += componentTax;
      if (component.is_compound) taxableAmount += componentTax;
    }

    return {
      taxAmount: totalTaxAmount,
      taxRate: netAmount > 0 ? (totalTaxAmount / netAmount) * 100 : 0,
    };
  }

  const thresholds = await knexOrTrx('tax_rate_thresholds')
    .where({ tenant, tax_rate_id: taxRate.tax_rate_id })
    .orderBy('min_amount');

  if (thresholds.length > 0) {
    return calculateThresholdBasedTax(thresholds, netAmount);
  }

  if (netAmount <= 0) {
    return { taxAmount: 0, taxRate: toNumber(taxRate.tax_percentage) };
  }

  const taxRatePercentage = toNumber(taxRate.tax_percentage);
  return {
    taxAmount: Math.ceil((netAmount * taxRatePercentage) / 100),
    taxRate: taxRatePercentage,
  };
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

  const distinctLocationIds = Array.from(
    new Set(
      items
        .map((item) => item.location_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const locationRegionMap = new Map<string, string | null>();
  if (distinctLocationIds.length > 0) {
    const locationRows = await knexOrTrx('client_locations')
      .where({ tenant })
      .whereIn('location_id', distinctLocationIds)
      .select('location_id', 'region_code');
    for (const row of locationRows) {
      locationRegionMap.set(
        row.location_id as string,
        (row.region_code as string | null | undefined) ?? null
      );
    }
  }

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
    // Preserve manual override: if tax_region was explicitly set on the item, keep it.
    // Otherwise fall back to the item's location.region_code, then to the client default.
    const locationRegionCode = item.location_id
      ? (locationRegionMap.get(item.location_id) ?? null)
      : null;
    const taxRegion = item.tax_region ?? locationRegionCode ?? client?.region_code ?? null;

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

      if (isIncludedInTotals && quote.client_id && taxSource === 'internal') {
        const taxResult = await calculateTaxWithConnection(
          knexOrTrx,
          tenant,
          quote.client_id,
          netAmount,
          quoteDate,
          taxRegion ?? undefined,
          item.is_taxable !== false,
          currencyCode
        );

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
