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
};

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
    unit_price: Number(item.default_rate ?? 0),
    unit_of_measure: item.unit_of_measure ?? null,
    phase: null,
    is_optional: false,
    is_selected: true,
    is_recurring: false,
    billing_frequency: null,
  };
}

export function formatDraftQuoteMoney(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}

