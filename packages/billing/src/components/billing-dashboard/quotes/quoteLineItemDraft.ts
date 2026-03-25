import type { CatalogPickerItem } from '../../../actions/serviceActions';
import type { IQuoteItem } from '@alga-psa/types';

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
  };
}

export function createDraftQuoteItemFromService(item: CatalogPickerItem): DraftQuoteItem {
  return {
    local_id: buildLocalId(),
    service_id: item.service_id,
    service_item_kind: item.item_kind,
    service_name: item.service_name,
    service_sku: item.sku ?? null,
    billing_method: item.billing_method,
    description: item.service_name,
    quantity: 1,
    unit_price: Number(item.currency_rate ?? item.default_rate ?? 0),
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
  };
}

function included(item: DraftQuoteItem): boolean {
  return !item.is_optional || item.is_selected !== false;
}

function computeDiscountAmount(item: DraftQuoteItem, baseAmount: number): number {
  if (item.discount_type === 'percentage') {
    return Math.round(baseAmount * ((item.discount_percentage ?? 0) / 100));
  }

  return item.quantity * item.unit_price;
}

export function calculateDraftQuoteTotals(items: DraftQuoteItem[]): DraftQuoteTotals {
  const includedBaseItems = items.filter((item) => !item.is_discount && included(item));
  const baseSubtotal = includedBaseItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  const baseItemTotals = new Map(includedBaseItems.map((item) => [item.quote_item_id ?? item.local_id, item.quantity * item.unit_price]));
  const baseServiceTotals = new Map<string, number>();

  for (const item of includedBaseItems) {
    if (!item.service_id) {
      continue;
    }

    baseServiceTotals.set(item.service_id, (baseServiceTotals.get(item.service_id) ?? 0) + (item.quantity * item.unit_price));
  }

  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;

  for (const item of items) {
    const totalPrice = item.quantity * item.unit_price;
    const scopedBaseAmount = item.applies_to_item_id
      ? (baseItemTotals.get(item.applies_to_item_id) ?? 0)
      : item.applies_to_service_id
        ? (baseServiceTotals.get(item.applies_to_service_id) ?? 0)
        : baseSubtotal;
    const resolvedTotal = item.is_discount ? computeDiscountAmount(item, scopedBaseAmount) : totalPrice;

    if (!included(item)) {
      continue;
    }

    if (item.is_discount) {
      discountTotal += resolvedTotal;
      continue;
    }

    subtotal += resolvedTotal;
    if (item.is_taxable !== false && item.tax_rate) {
      tax += Math.round(resolvedTotal * (item.tax_rate / 100));
    }
  }

  return {
    subtotal,
    discount_total: discountTotal,
    tax,
    total_amount: subtotal - discountTotal + tax,
  };
}

export function formatDraftQuoteMoney(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}
