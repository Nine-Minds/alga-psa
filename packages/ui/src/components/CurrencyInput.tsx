'use client';

import React, { useState, useEffect } from 'react';
import { Input } from './Input';
import { useOptionalI18n } from '../lib/i18n/client';
import { LOCALE_CONFIG } from '../lib/i18n/config';
import { currencyFractionDigits } from '@alga-psa/core';

interface CurrencyInputProps {
  id?: string;
  label?: string;
  value?: number;
  onChange?: (value: number | undefined) => void;
  currencyCode?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  containerClassName?: string;
}

export function getNumberSeparators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
}

export function formatCurrencyValue(value: number, locale: string, currencyCode: string = 'USD'): string {
  const fractionDigits = currencyFractionDigits(currencyCode, locale);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Parse user input under the given locale's number conventions. Keeps digits,
 * sign, and the locale's decimal separator (normalized to '.'); drops
 * everything else, which covers group separators including the plain-space,
 * NBSP, and narrow-NBSP variants.
 */
export function parseCurrencyValue(raw: string, locale: string): number {
  const { decimal } = getNumberSeparators(locale);
  let normalized = '';
  for (const ch of raw) {
    if ((ch >= '0' && ch <= '9') || ch === '-') {
      normalized += ch;
    } else if (ch === decimal) {
      normalized += '.';
    }
  }
  return parseFloat(normalized);
}

export function CurrencyInput({
  id,
  label,
  value,
  onChange,
  currencyCode = 'USD',
  disabled = false,
  required,
  placeholder,
  className = '',
  containerClassName,
}: CurrencyInputProps) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? LOCALE_CONFIG.defaultLocale;
  const [displayValue, setDisplayValue] = useState('');

  useEffect(() => {
    if (value === undefined || value === null || isNaN(value)) {
      setDisplayValue('');
    } else {
      setDisplayValue(formatCurrencyValue(value, locale, currencyCode));
    }
  }, [currencyCode, value, locale]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplayValue(raw);

    const numeric = parseCurrencyValue(raw, locale);
    if (raw === '' || isNaN(numeric)) {
      onChange?.(undefined);
    } else {
      onChange?.(numeric);
    }
  };

  const handleBlur = () => {
    const numeric = parseCurrencyValue(displayValue, locale);
    if (!isNaN(numeric)) {
      setDisplayValue(formatCurrencyValue(numeric, locale, currencyCode));
    } else {
      setDisplayValue('');
    }
  };

  return (
    <Input
      id={id}
      label={label}
      type="text"
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder ?? formatCurrencyValue(0, locale, currencyCode)}
      disabled={disabled}
      required={required}
      className={className}
      containerClassName={containerClassName}
    />
  );
}
