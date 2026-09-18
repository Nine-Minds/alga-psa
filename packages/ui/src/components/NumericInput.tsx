'use client';

import React, { useEffect, useState } from 'react';
import { Input } from './Input';
import { useOptionalI18n } from '../lib/i18n/client';
import { LOCALE_CONFIG } from '../lib/i18n/config';
import { getNumberSeparators } from './CurrencyInput';

export function parseNumericValue(raw: string, locale: string): number {
  const { decimal } = getNumberSeparators(locale);
  const normalized = Array.from(raw, (character) =>
    (character >= '0' && character <= '9') || character === '-' ? character : character === decimal ? '.' : '',
  ).join('');
  return Number.parseFloat(normalized);
}

export function NumericInput({ id, value, onChange, precision = 2, ...props }: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value?: number;
  onChange?: (value: number | undefined) => void;
  precision?: number;
}) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? LOCALE_CONFIG.defaultLocale;
  const [displayValue, setDisplayValue] = useState('');

  const format = (number: number) => new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(number);

  useEffect(() => setDisplayValue(value === undefined || Number.isNaN(value) ? '' : format(value)), [value, locale, precision]);

  return <Input id={id} type="text" inputMode="decimal" value={displayValue} onChange={(event) => {
    const raw = event.target.value;
    setDisplayValue(raw);
    const parsed = parseNumericValue(raw, locale);
    onChange?.(raw === '' || Number.isNaN(parsed) ? undefined : parsed);
  }} onBlur={() => {
    const parsed = parseNumericValue(displayValue, locale);
    setDisplayValue(Number.isNaN(parsed) ? '' : format(parsed));
  }} {...props} />;
}
