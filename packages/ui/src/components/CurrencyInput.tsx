'use client';

import React, { useState, useEffect } from 'react';
import { Input } from './Input';

interface CurrencyInputProps {
  id?: string;
  value?: number;
  onChange?: (value: number | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CurrencyInput({
  id,
  value,
  onChange,
  disabled = false,
  placeholder = '0.00',
  className = '',
}: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = useState('');

  useEffect(() => {
    if (value === undefined || value === null || isNaN(value)) {
      setDisplayValue('');
    } else {
      setDisplayValue(formatNumber(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplayValue(raw);

    const numeric = parseFloat(raw.replace(/,/g, ''));
    if (raw === '' || isNaN(numeric)) {
      onChange?.(undefined);
    } else {
      onChange?.(numeric);
    }
  };

  const handleBlur = () => {
    const numeric = parseFloat(displayValue.replace(/,/g, ''));
    if (!isNaN(numeric)) {
      setDisplayValue(formatNumber(numeric));
    } else {
      setDisplayValue('');
    }
  };

  return (
    <Input
      id={id}
      type="text"
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}
