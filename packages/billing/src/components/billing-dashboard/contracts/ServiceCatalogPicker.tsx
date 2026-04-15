'use client';

import React, { useCallback, useRef } from 'react';
import AsyncSearchableSelect, { SelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { getServiceById, searchServiceCatalogForPicker, CatalogPickerItem } from '@alga-psa/billing/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type BillingMethod = 'fixed' | 'hourly' | 'usage';
type ItemKind = 'service' | 'product';

export type ServiceCatalogPickerItem = CatalogPickerItem;

// Module-level cache for request deduplication across ServiceCatalogPicker instances.
// This prevents N+1 API calls when multiple pickers with the same filters are rendered.
// Cache entries expire after 30 seconds to ensure freshness.
interface CacheEntry {
  promise: Promise<{ items: CatalogPickerItem[]; totalCount: number }>;
  timestamp: number;
}
const requestCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30000; // 30 seconds

function getCacheKey(params: {
  search: string;
  page: number;
  limit: number;
  is_active?: boolean;
  billing_methods?: BillingMethod[];
  item_kinds?: ItemKind[];
  currency_code?: string;
}): string {
  return JSON.stringify({
    search: params.search,
    page: params.page,
    limit: params.limit,
    is_active: params.is_active,
    billing_methods: params.billing_methods?.sort(),
    item_kinds: params.item_kinds?.sort(),
    currency_code: params.currency_code,
  });
}

function getCachedOrFetch(params: {
  search: string;
  page: number;
  limit: number;
  is_active?: boolean;
  billing_methods?: BillingMethod[];
  item_kinds?: ItemKind[];
  currency_code?: string;
}): Promise<{ items: CatalogPickerItem[]; totalCount: number }> {
  const cacheKey = getCacheKey(params);
  const now = Date.now();

  // Check for valid cached entry
  const cached = requestCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.promise;
  }

  // Create new request and cache it
  const promise = searchServiceCatalogForPicker(params);
  requestCache.set(cacheKey, { promise, timestamp: now });

  // Clean up old cache entries periodically
  if (requestCache.size > 50) {
    for (const [key, entry] of requestCache) {
      if (now - entry.timestamp >= CACHE_TTL_MS) {
        requestCache.delete(key);
      }
    }
  }

  return promise;
}

interface ServiceCatalogPickerProps {
  value: string;
  selectedLabel?: string;
  onSelect: (item: ServiceCatalogPickerItem) => void;
  /** Called when user adds a custom line item via the dropdown footer. */
  onAddCustom?: (description: string) => void;
  billingMethods?: BillingMethod[];
  itemKinds?: ItemKind[];
  isActive?: boolean;
  /** When provided, the picker returns the currency-specific rate from service_prices alongside default_rate. */
  currencyCode?: string;
  placeholder?: string;
  label?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  debounceMs?: number;
}

export function ServiceCatalogPicker({
  value,
  selectedLabel,
  onSelect,
  onAddCustom,
  billingMethods,
  itemKinds,
  isActive = true,
  currencyCode,
  placeholder,
  label,
  id,
  className,
  disabled,
  debounceMs = 300,
}: ServiceCatalogPickerProps): React.JSX.Element {
  const { t } = useTranslation('msp/contracts');
  const lastItemsByIdRef = useRef<Record<string, ServiceCatalogPickerItem>>({});
  const resolvedPlaceholder = placeholder ?? t('servicePicker.catalog.placeholder', { defaultValue: 'Select item...' });

  const loadOptions = useCallback(
    async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
      // Use cached request to prevent N+1 API calls when multiple pickers have same filters
      const result = await getCachedOrFetch({
        search,
        page,
        limit,
        is_active: isActive,
        billing_methods: billingMethods,
        item_kinds: itemKinds,
        currency_code: currencyCode,
      });

      lastItemsByIdRef.current = result.items.reduce<Record<string, ServiceCatalogPickerItem>>((acc, item) => {
        acc[item.service_id] = item;
        return acc;
      }, {});

      const options: SelectOption[] = result.items.map((item) => ({
        value: item.service_id,
        label: item.item_kind === 'product' && item.sku
          ? `${item.service_name} (${item.sku})`
          : item.service_name,
        badge: item.item_kind === 'product'
          ? {
            text: t('servicePicker.catalog.badges.product', { defaultValue: 'Product' }),
            variant: 'primary' as const,
          }
          : {
            text: t('servicePicker.catalog.badges.service', { defaultValue: 'Service' }),
            variant: 'default' as const,
          },
      }));

      return { options, total: result.totalCount };
    },
    [billingMethods, currencyCode, isActive, itemKinds, t]
  );

  const handleChange = useCallback(
    async (nextValue: string) => {
      const cached = lastItemsByIdRef.current[nextValue];
      if (cached) {
        onSelect(cached);
        return;
      }

      const item = await getServiceById(nextValue);
      if (item) {
        onSelect({
          service_id: item.service_id,
          service_name: item.service_name,
          billing_method: item.billing_method,
          unit_of_measure: item.unit_of_measure,
          item_kind: item.item_kind,
          sku: item.sku ?? null,
          default_rate: Number(item.default_rate ?? 0),
        });
        return;
      }

      onSelect({
        service_id: nextValue,
        service_name: selectedLabel ?? '',
        billing_method: 'fixed',
        unit_of_measure: 'unit',
        item_kind: 'service',
        sku: null,
        default_rate: 0,
      });
    },
    [onSelect, selectedLabel]
  );

  return (
    <AsyncSearchableSelect
      id={id}
      label={label}
      value={value}
      selectedLabel={selectedLabel}
      onChange={(v) => void handleChange(v)}
      loadOptions={loadOptions}
      limit={10}
      debounceMs={debounceMs}
      placeholder={resolvedPlaceholder}
      className={className}
      dropdownMode="overlay"
      searchPlaceholder={t('servicePicker.catalog.searchPlaceholder', { defaultValue: 'Search items...' })}
      emptyMessage={t('servicePicker.catalog.emptyMessage', { defaultValue: 'No matching items.' })}
      disabled={disabled}
      showMoreIndicator
      footerContent={onAddCustom ? ({ search, close }) => {
        const trimmed = search.trim();
        return (
          <button
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${trimmed ? 'hover:bg-[rgb(var(--color-border-100))] cursor-pointer' : 'opacity-50 cursor-default'}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!trimmed) return;
              onAddCustom(trimmed);
              close();
            }}
          >
            <span className="inline-flex items-center rounded bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 text-xs font-medium text-[rgb(var(--color-text-600))]">
              {t('servicePicker.catalog.custom.badge', { defaultValue: 'Custom' })}
            </span>
            {trimmed
              ? (
                <span>
                  {t('servicePicker.catalog.custom.addAsCustomItem', {
                    defaultValue: 'Add “{{name}}” as custom item',
                    name: trimmed,
                  })}
                </span>
              )
              : (
                <span className="text-[rgb(var(--color-text-400))]">
                  {t('servicePicker.catalog.custom.typeNameHint', { defaultValue: 'Type a name to add a custom item' })}
                </span>
              )
            }
          </button>
        );
      } : undefined}
    />
  );
}

export default ServiceCatalogPicker;
