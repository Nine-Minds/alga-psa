'use client';

import React, { useEffect, useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { decimalTextToMinorUnits, minorUnitsToDecimalText } from '@alga-psa/core/formatters';

interface TemplateAmountInputProps {
  id: string;
  /** ISO currency the amount is in (symbol and fraction digits come from it). */
  currency: string;
  valueCents: number | null | undefined;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
  /** Called with minor units, or `undefined` when the field is emptied. */
  onCommit: (cents: number | undefined) => void;
}

const textFor = (cents: number | null | undefined, currency: string): string => {
  if (cents == null) return '';
  try {
    return minorUnitsToDecimalText(cents, currency);
  } catch {
    return '';
  }
};

/** Symbol-prefixed amount input in minor units; text while typing, committed on blur. */
export function TemplateAmountInput({
  id,
  currency,
  valueCents,
  placeholder,
  disabled,
  onCommit,
  ...rest
}: TemplateAmountInputProps) {
  const { symbol } = useCurrencyFormat();
  const [text, setText] = useState(() => textFor(valueCents, currency));
  useEffect(() => {
    setText(textFor(valueCents, currency));
  }, [valueCents, currency]);

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-400))]">
        {symbol(currency)}
      </span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={rest['aria-label']}
        className="pl-10"
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9.,]/g, '');
          setText(next);
        }}
        onBlur={() => {
          if (text.trim() === '') {
            onCommit(undefined);
            return;
          }
          try {
            const cents = decimalTextToMinorUnits(text, currency);
            if (cents == null) {
              onCommit(undefined);
              return;
            }
            setText(textFor(cents, currency));
            onCommit(cents);
          } catch {
            // Unparseable or too precise for the currency: restore the last committed value.
            setText(textFor(valueCents, currency));
          }
        }}
      />
    </div>
  );
}
