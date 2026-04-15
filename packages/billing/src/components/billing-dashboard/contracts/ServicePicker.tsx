'use client';

import React from 'react';
import { cn } from '@alga-psa/ui/lib/utils';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface SelectOption {
  value: string;
  label: string;
}

interface ServicePickerProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  id?: string;
}

export function ServicePicker({
  options,
  value,
  onChange,
  placeholder,
  className = '',
  disabled = false,
  label,
  id,
}: ServicePickerProps): React.JSX.Element {
  const { t } = useTranslation('msp/contracts');
  const autoId = React.useId();
  const pickerId = id ?? `service-picker-${autoId}`;
  const resolvedPlaceholder = placeholder ?? t('servicePicker.placeholder', { defaultValue: 'Select service...' });

  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('servicePicker.searchPlaceholder', { defaultValue: 'Search services...' })}
      dropdownMode="overlay"
      maxListHeight="250px"
      disabled={disabled}
      label={label}
      id={pickerId}
      className={cn(
        "bg-card border border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-700))]",
        "hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))]",
        className
      )}
      emptyMessage={t('servicePicker.emptyMessage', { defaultValue: 'No service found.' })}
    />
  );
}
