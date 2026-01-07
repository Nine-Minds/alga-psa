'use client';

import React, { useCallback, useRef } from 'react';
import AsyncSearchableSelect, { SelectOption } from 'server/src/components/ui/AsyncSearchableSelect';
import { getServiceById, searchServiceCatalogForPicker, CatalogPickerItem } from 'server/src/lib/actions/serviceActions';

type BillingMethod = 'fixed' | 'hourly' | 'usage' | 'per_unit';
type ItemKind = 'service' | 'product';

export type ServiceCatalogPickerItem = CatalogPickerItem;

interface ServiceCatalogPickerProps {
  value: string;
  selectedLabel?: string;
  onSelect: (item: ServiceCatalogPickerItem) => void;
  billingMethods?: BillingMethod[];
  itemKinds?: ItemKind[];
  isActive?: boolean;
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
  billingMethods,
  itemKinds,
  isActive = true,
  placeholder = 'Select item...',
  label,
  id,
  className,
  disabled,
  debounceMs = 300,
}: ServiceCatalogPickerProps): React.JSX.Element {
  const lastItemsByIdRef = useRef<Record<string, ServiceCatalogPickerItem>>({});

  const loadOptions = useCallback(
    async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
      const result = await searchServiceCatalogForPicker({
        search,
        page,
        limit,
        is_active: isActive,
        billing_methods: billingMethods,
        item_kinds: itemKinds,
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
          ? { text: 'Product', variant: 'primary' as const }
          : { text: 'Service', variant: 'default' as const },
      }));

      return { options, total: result.totalCount };
    },
    [billingMethods, itemKinds, isActive]
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
      placeholder={placeholder}
      className={className}
      dropdownMode="overlay"
      searchPlaceholder="Search items..."
      emptyMessage="No matching items."
      disabled={disabled}
      showMoreIndicator
    />
  );
}

export default ServiceCatalogPicker;
