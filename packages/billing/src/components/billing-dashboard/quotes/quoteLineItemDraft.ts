import type { CatalogPickerItem } from '../../../actions/serviceActions';
import type { IQuoteItem } from '@alga-psa/types';
import { allocateQuoteDiscounts } from '../../../services/quoteDiscountAllocation';

export type DraftQuoteItem = {
  local_id: string;
  quote_item_id?: string;
  service_id?: string | null;
  service_item_kind?: 'service' | 'product' | null;
  service_name?: string | null;
  service_sku?: string | null;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null;
  description: string;
  quantity: number;
  unit_price: number;
  /** Product cost snapshot in minor currency units (from service_catalog). */
  cost?: number | null;
  /** ISO 4217 currency code for the cost field. */
  cost_currency?: string | null;
  /** True when the service has no price in the quote's currency and the user must enter one. */
  needs_price?: boolean;
  unit_of_measure?: string | null;
  phase?: string | null;
  is_optional: boolean;
  is_selected: boolean;
  is_recurring: boolean;
  billing_frequency?: string | null;
  is_discount?: boolean;
  discount_type?: 'percentage' | 'fixed' | null;
  discount_percentage?: number | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
  is_taxable?: boolean;
  tax_region?: string | null;
  tax_rate?: number | null;
  location_id?: string | null;
};

export interface DraftQuoteTotals {
  subtotal: number;
  discount_total: number;
  tax: number;
  total_amount: number;
}

function buildLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `quote-item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDraftQuoteItemFromQuoteItem(item: IQuoteItem): DraftQuoteItem {
  return {
    local_id: item.quote_item_id,
    quote_item_id: item.quote_item_id,
    service_id: item.service_id ?? null,
    service_item_kind: item.service_item_kind ?? null,
    service_name: item.service_name ?? null,
    service_sku: item.service_sku ?? null,
    billing_method: item.billing_method ?? null,
    description: item.description,
    quantity: Number(item.quantity ?? 1),
    unit_price: Number(item.unit_price ?? 0),
    cost: item.cost ?? null,
    cost_currency: item.cost_currency ?? null,
    unit_of_measure: item.unit_of_measure ?? null,
    phase: item.phase ?? null,
    is_optional: Boolean(item.is_optional),
    is_selected: item.is_selected ?? true,
    is_recurring: Boolean(item.is_recurring),
    billing_frequency: item.billing_frequency ?? null,
    is_discount: item.is_discount ?? false,
    discount_type: item.discount_type ?? null,
    discount_percentage: item.discount_percentage ?? null,
    applies_to_item_id: item.applies_to_item_id ?? null,
    applies_to_service_id: item.applies_to_service_id ?? null,
    is_taxable: item.is_taxable ?? true,
    tax_region: item.tax_region ?? null,
    tax_rate: item.tax_rate ?? null,
    location_id: item.location_id ?? null,
  };
}

export function createDraftQuoteItemFromService(item: CatalogPickerItem, quoteCurrencyCode?: string): DraftQuoteItem {
  const hasCurrencyRate = item.currency_rate != null;
  // Only flag needs_price when the service has multi-currency pricing configured
  // but no rate for the quote's currency. Services without any service_prices rows
  // use default_rate as their universal price.
  const needsPrice = Boolean(quoteCurrencyCode) && !hasCurrencyRate && Boolean(item.has_currency_prices);

  return {
    local_id: buildLocalId(),
    service_id: item.service_id,
    service_item_kind: item.item_kind,
    service_name: item.service_name,
    service_sku: item.sku ?? null,
    billing_method: item.billing_method,
    description: item.service_name,
    quantity: 1,
    unit_price: needsPrice ? 0 : Number(item.currency_rate ?? item.default_rate ?? 0),
    cost: item.item_kind === 'product' ? (item.cost ?? null) : null,
    cost_currency: item.item_kind === 'product' ? (item.cost_currency ?? null) : null,
    needs_price: needsPrice,
    unit_of_measure: item.unit_of_measure ?? null,
    phase: null,
    is_optional: false,
    is_selected: true,
    is_recurring: false,
    billing_frequency: null,
    is_discount: false,
    discount_type: null,
    discount_percentage: null,
    applies_to_item_id: null,
    applies_to_service_id: null,
    is_taxable: true,
    tax_region: null,
    tax_rate: null,
    location_id: null,
  };
}

export function createCustomDraftQuoteItem(input: {
  description: string;
  quantity?: number;
  unit_price?: number;
  unit_of_measure?: string | null;
}): DraftQuoteItem {
  return {
    local_id: buildLocalId(),
    service_id: null,
    service_item_kind: null,
    service_name: null,
    service_sku: null,
    billing_method: null,
    description: input.description,
    quantity: Number(input.quantity ?? 1),
    unit_price: Number(input.unit_price ?? 0),
    unit_of_measure: input.unit_of_measure ?? null,
    phase: null,
    is_optional: false,
    is_selected: true,
    is_recurring: false,
    billing_frequency: null,
    is_discount: false,
    discount_type: null,
    discount_percentage: null,
    applies_to_item_id: null,
    applies_to_service_id: null,
    is_taxable: true,
    tax_region: null,
    tax_rate: null,
    location_id: null,
  };
}

export function createDraftDiscountQuoteItem(input: {
  description: string;
  discount_type: 'percentage' | 'fixed';
  discount_percentage?: number | null;
  fixed_amount?: number;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
}): DraftQuoteItem {
  return {
    local_id: buildLocalId(),
    service_id: null,
    service_item_kind: null,
    service_name: null,
    service_sku: null,
    billing_method: null,
    description: input.description,
    quantity: 1,
    unit_price: input.discount_type === 'fixed' ? Number(input.fixed_amount ?? 0) : 0,
    unit_of_measure: null,
    phase: null,
    is_optional: false,
    is_selected: true,
    is_recurring: false,
    billing_frequency: null,
    is_discount: true,
    discount_type: input.discount_type,
    discount_percentage: input.discount_type === 'percentage' ? (input.discount_percentage ?? 0) : null,
    applies_to_item_id: input.applies_to_item_id ?? null,
    applies_to_service_id: input.applies_to_service_id ?? null,
    is_taxable: false,
    tax_region: null,
    tax_rate: 0,
    location_id: null,
  };
}

function included(item: DraftQuoteItem): boolean {
  return !item.is_optional || item.is_selected !== false;
}

export function calculateDraftQuoteTotals(items: DraftQuoteItem[]): DraftQuoteTotals {
  const includedBaseItems = items.filter((item) => !item.is_discount && included(item));
  const baseItemId = (item: DraftQuoteItem): string => item.quote_item_id ?? item.local_id;

  const bases = includedBaseItems.map((item) => ({
    id: baseItemId(item),
    serviceId: item.service_id ?? null,
    amount: item.quantity * item.unit_price,
    isRecurring: item.is_recurring === true,
  }));

  const discounts = items
    .filter((item) => item.is_discount && included(item))
    .map((item) => ({
      id: baseItemId(item),
      discountType: (item.discount_type === 'percentage' ? 'percentage' : 'fixed') as 'percentage' | 'fixed',
      fixedAmount: item.quantity * item.unit_price,
      discountPercentage: item.discount_percentage ?? 0,
      appliesToItemId: item.applies_to_item_id ?? null,
      appliesToServiceId: item.applies_to_service_id ?? null,
    }));

  const allocation = allocateQuoteDiscounts(bases, discounts);

  const subtotal = includedBaseItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  const discountTotal = allocation.totalDiscount;

  let tax = 0;
  for (const item of includedBaseItems) {
    const totalPrice = item.quantity * item.unit_price;
    if (item.is_taxable !== false && item.tax_rate) {
      tax += Math.round(totalPrice * (item.tax_rate / 100));
    }
  }

  return {
    subtotal,
    discount_total: discountTotal,
    tax,
    total_amount: subtotal - discountTotal + tax,
  };
}

/**
 * Resolve the displayed reduction of every discount row from the current item
 * state, keyed by the row's stable id. Used by the editor's amount column so
 * discount rows and the sidebar discount total always agree (both derive from
 * the shared allocation).
 */
export function resolveDraftDiscountAmounts(items: DraftQuoteItem[]): Map<string, number> {
  const includedBaseItems = items.filter((i) => !i.is_discount && included(i));
  const baseItemId = (i: DraftQuoteItem): string => i.quote_item_id ?? i.local_id;
  const bases = includedBaseItems.map((i) => ({
    id: baseItemId(i),
    serviceId: i.service_id ?? null,
    amount: i.quantity * i.unit_price,
    isRecurring: i.is_recurring === true,
  }));
  const discounts = items
    .filter((i) => i.is_discount && included(i))
    .map((i) => ({
      id: baseItemId(i),
      discountType: (i.discount_type === 'percentage' ? 'percentage' : 'fixed') as 'percentage' | 'fixed',
      fixedAmount: i.quantity * i.unit_price,
      discountPercentage: i.discount_percentage ?? 0,
      appliesToItemId: i.applies_to_item_id ?? null,
      appliesToServiceId: i.applies_to_service_id ?? null,
    }));
  const allocation = allocateQuoteDiscounts(bases, discounts);
  const byId = new Map<string, number>();
  for (const result of allocation.discounts) {
    byId.set(result.discountId, result.resolvedAmount);
  }
  return byId;
}

/**
 * Recurring monthly net after derived discount allocation, in minor units.
 *
 * Feeds the "$X recurring / month" sidebar figure. It starts from the same
 * per-base allocations as the group subtotals so discounts aimed at recurring
 * monthly services reduce the figure (two $5 discounts over $25 + $35 monthly
 * services read $50, not $60). Mixed billing frequencies participate through
 * their own allocations; only strictly-monthly (or unset-frequency) recurring
 * base rows contribute to the per-month figure.
 */
export function calculateDraftMonthlyRecurringNet(items: DraftQuoteItem[]): number {
  const includedBaseItems = items.filter((item) => !item.is_discount && included(item));
  const baseItemId = (item: DraftQuoteItem): string => item.quote_item_id ?? item.local_id;

  const bases = includedBaseItems.map((item) => ({
    id: baseItemId(item),
    serviceId: item.service_id ?? null,
    amount: item.quantity * item.unit_price,
    isRecurring: item.is_recurring === true,
  }));

  const discounts = items
    .filter((item) => item.is_discount && included(item))
    .map((item) => ({
      id: baseItemId(item),
      discountType: (item.discount_type === 'percentage' ? 'percentage' : 'fixed') as 'percentage' | 'fixed',
      fixedAmount: item.quantity * item.unit_price,
      discountPercentage: item.discount_percentage ?? 0,
      appliesToItemId: item.applies_to_item_id ?? null,
      appliesToServiceId: item.applies_to_service_id ?? null,
    }));

  const allocation = allocateQuoteDiscounts(bases, discounts);
  const consumedByBase = new Map<string, number>();
  for (const result of allocation.discounts) {
    for (const itemAllocation of result.allocations) {
      consumedByBase.set(
        itemAllocation.baseItemId,
        (consumedByBase.get(itemAllocation.baseItemId) ?? 0) + itemAllocation.amount,
      );
    }
  }

  let net = 0;
  for (const item of includedBaseItems) {
    if (!item.is_recurring) continue;
    const freq = (item.billing_frequency || '').toLowerCase();
    if (freq && freq !== 'monthly') continue;
    const base = item.quantity * item.unit_price;
    net += Math.max(0, base - (consumedByBase.get(baseItemId(item)) ?? 0));
  }
  return net;
}

export function formatDraftQuoteMoney(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}
