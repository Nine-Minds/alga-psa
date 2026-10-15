'use client'

import React from 'react';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import { cn } from '../lib/utils';
import { SearchableSelect, SelectOption } from './SearchableSelect';

export type CurrencyPickerOption = SelectOption;

type CurrencyPickerSize = 'sm' | 'md' | 'lg';

interface CurrencyPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Override the currency list, e.g. a filtered subset or a custom leading entry */
  options?: CurrencyPickerOption[];
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  size?: CurrencyPickerSize;
  dropdownMode?: 'inline' | 'overlay';
}

export function CurrencyPicker({
  value,
  onValueChange,
  options = CURRENCY_OPTIONS,
  id,
  label,
  placeholder,
  disabled = false,
  required = false,
  className,
  size = 'md',
  dropdownMode = 'overlay',
}: CurrencyPickerProps): React.JSX.Element {
  return (
    <SearchableSelect
      id={id}
      label={label}
      options={options}
      value={value}
      onChange={onValueChange}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      // md keeps CustomSelect's trigger height so rows stay aligned with neighbouring fields
      className={cn(size === 'md' && 'h-9', className)}
      size={size}
      dropdownMode={dropdownMode}
    />
  );
}

export default CurrencyPicker;
