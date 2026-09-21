import type { CatalogPickerItem } from '../../../actions/serviceActions';
import type { IQuoteItem } from '@alga-psa/types';
import { allocateQuoteDiscounts } from '../../../services/quoteDiscountAllocation';
import { compareCadenceKeys, cadenceDefaultName, isRecurringCadenceKey, resolveCadenceKey } from '../../../lib/quoteItemCadence';
import { isOptional, isQuoteItemIncluded, isRequired } from '../../../lib/quoteItemInclusion';
import { hypotheticalTaxAmount } from '../../../lib/quoteItemTax';

export type DraftQuoteItem = {
  local_id: string;
  quote_item_id?: string;
  service_id?: string | null;
  service_item_kind?: 'service' | 'product' | null;
  service_name?: string | null;
  service_sku?: string | null;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null;
  description: string;
  /** Quote-time snapshot of the catalog item's description (null for custom,
   *  discount, and legacy lines). Carried for immediate draft preview only —
   *  the server re-resolves the authoritative snapshot on persistence. */
  catalog_description?: string | null;
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
  /** Optional (if-selected) add-ons, excluded from the base figures above. */
  optional_subtotal: number;
  optional_tax: number;
  optional_total: number;
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
    catalog_description: item.catalog_description ?? null,
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
    catalog_description: item.description && item.description.trim() ? item.description.trim() : null,
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
    catalog_description: null,
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
    catalog_description: null,
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

const draftBaseItemId = (item: DraftQuoteItem): string => item.quote_item_id ?? item.local_id;

/**
 * Allocation inputs shared by the draft totals, the discount amount column and
 * the cadence summary. Bases and discounts follow the same legacy inclusion the
 * adapter and the persisted recalculation use (required always, optional only
 * while selected) so the editor and the rendered PDF derive identical
 * allocations. Optional add-ons are still reported separately, never as base.
 */
function buildDraftAllocationInputs(items: DraftQuoteItem[]) {
  const allocationBases = items.filter((item) => !item.is_discount && isQuoteItemIncluded(item));
  const bases = allocationBases.map((item) => ({
    id: draftBaseItemId(item),
    serviceId: item.service_id ?? null,
    amount: item.quantity * item.unit_price,
    isRecurring: item.is_recurring === true,
  }));

  const discounts = items
    .filter((item) => item.is_discount && isQuoteItemIncluded(item))
    .map((item) => ({
      id: draftBaseItemId(item),
      discountType: (item.discount_type === 'percentage' ? 'percentage' : 'fixed') as 'percentage' | 'fixed',
      fixedAmount: item.quantity * item.unit_price,
      discountPercentage: item.discount_percentage ?? 0,
      appliesToItemId: item.applies_to_item_id ?? null,
      appliesToServiceId: item.applies_to_service_id ?? null,
    }));

  return { allocationBases, bases, discounts };
}

export function calculateDraftQuoteTotals(items: DraftQuoteItem[]): DraftQuoteTotals {
  const { allocationBases, bases, discounts } = buildDraftAllocationInputs(items);
  const allocation = allocateQuoteDiscounts(bases, discounts);

  const optionalById = new Map(allocationBases.map((item) => [draftBaseItemId(item), isOptional(item)]));
  const requiredBaseItems = items.filter((item) => !item.is_discount && isRequired(item));
  const optionalBaseItems = items.filter((item) => !item.is_discount && isOptional(item));

  const subtotal = requiredBaseItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const optionalSubtotal = optionalBaseItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  let discountTotal = 0;
  let optionalDiscountTotal = 0;
  for (const result of allocation.discounts) {
    for (const itemAllocation of result.allocations) {
      if (optionalById.get(itemAllocation.baseItemId)) optionalDiscountTotal += itemAllocation.amount;
      else discountTotal += itemAllocation.amount;
    }
  }

  // Draft rows carry the persisted rate, so the editor derives tax the same
  // way the adapter does for unselected optional rows (ceil to the cent).
  const taxFor = (baseItems: DraftQuoteItem[]): number =>
    baseItems.reduce(
      (sum, item) => sum + hypotheticalTaxAmount({ ...item, total_price: item.quantity * item.unit_price }),
      0,
    );

  const tax = taxFor(requiredBaseItems);
  const optionalTax = taxFor(optionalBaseItems);

  return {
    subtotal,
    discount_total: discountTotal,
    tax,
    total_amount: subtotal - discountTotal + tax,
    optional_subtotal: optionalSubtotal,
    optional_tax: optionalTax,
    optional_total: optionalSubtotal - optionalDiscountTotal + optionalTax,
  };
}

/**
 * Resolve the displayed reduction of every discount row from the current item
 * state, keyed by the row's stable id. Used by the editor's amount column so
 * discount rows and the sidebar discount total always agree (both derive from
 * the shared allocation).
 */
export function resolveDraftDiscountAmounts(items: DraftQuoteItem[]): Map<string, number> {
  const { bases, discounts } = buildDraftAllocationInputs(items);
  const allocation = allocateQuoteDiscounts(bases, discounts);
  const byId = new Map<string, number>();
  for (const result of allocation.discounts) {
    byId.set(result.discountId, result.resolvedAmount);
  }
  return byId;
}

export interface DraftCadenceSummary {
  cadence_key: string;
  name: string;
  is_recurring: boolean;
  /** Required net for the band after its share of the discount allocation. */
  net: number;
  /** Optional add-on total for the band (if selected). */
  optional_total: number;
}

/**
 * Per-cadence required nets and optional add-on totals for the editor summary.
 *
 * Discounts are attributed to a band by the base item they reduce (via the
 * shared allocation), so the editor's per-cadence figures equal the PDF's
 * per-band totals on the same quote. Optional rows are reported separately and
 * never reduce the required `net`.
 */
export function calculateDraftCadenceSummary(items: DraftQuoteItem[]): DraftCadenceSummary[] {
  const { bases, discounts } = buildDraftAllocationInputs(items);
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

  const byCadence = new Map<string, DraftCadenceSummary>();
  const ensure = (key: string): DraftCadenceSummary => {
    let entry = byCadence.get(key);
    if (!entry) {
      entry = {
        cadence_key: key,
        name: cadenceDefaultName(key),
        is_recurring: isRecurringCadenceKey(key),
        net: 0,
        optional_total: 0,
      };
      byCadence.set(key, entry);
    }
    return entry;
  };

  for (const item of items) {
    if (item.is_discount) continue;
    const entry = ensure(resolveCadenceKey(item));
    const base = item.quantity * item.unit_price;
    if (isOptional(item)) {
      entry.optional_total += base;
    } else {
      entry.net += Math.max(0, base - (consumedByBase.get(draftBaseItemId(item)) ?? 0));
    }
  }

  return Array.from(byCadence.values()).sort((left, right) =>
    compareCadenceKeys(left.cadence_key, right.cadence_key),
  );
}

/**
 * Recurring monthly net after derived discount allocation, in minor units.
 *
 * Feeds the "$X recurring / month" sidebar figure. It starts from the same
 * per-base allocations as the group subtotals so discounts aimed at recurring
 * monthly services reduce the figure (two $5 discounts over $25 + $35 monthly
 * services read $50, not $60). Mixed billing frequencies participate through
 * their own allocations; only strictly-monthly (or unset-frequency) required
 * base rows contribute to the per-month figure.
 */
export function calculateDraftMonthlyRecurringNet(items: DraftQuoteItem[]): number {
  const monthly = calculateDraftCadenceSummary(items).find((entry) => entry.cadence_key === 'monthly');
  return monthly?.net ?? 0;
}

export function formatDraftQuoteMoney(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}
