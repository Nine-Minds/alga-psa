'use client';

import React from 'react';
import { cn } from '@alga-psa/ui/lib/utils';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';

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
  placeholder = 'Select service...',
  className = '',
  disabled = false,
  label,
  id,
}: ServicePickerProps): React.JSX.Element {
  const autoId = React.useId();
  const pickerId = id ?? `service-picker-${autoId}`;

  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search services..."
      dropdownMode="overlay"
      maxListHeight="250px"
      disabled={disabled}
      label={label}
      id={pickerId}
      className={cn(
        "bg-white border border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-700))]",
        "hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))]",
        className
      )}
      emptyMessage="No service found."
    />
  );
}
