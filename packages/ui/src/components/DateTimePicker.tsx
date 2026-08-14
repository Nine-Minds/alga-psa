'use client';

import * as React from 'react';
import { DateTimeField } from './DateTimeField';

interface DateTimePickerBaseProps {
  value?: Date;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Human-readable label for accessibility */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Minimum allowed date */
  minDate?: Date;
  /** Maximum allowed date */
  maxDate?: Date;
  /** Time format preference; when unset, derived from the active locale */
  timeFormat?: '12h' | '24h';
  /** Ref for the component */
  ref?: React.Ref<HTMLDivElement>;
}

interface DateTimePickerClearableProps extends DateTimePickerBaseProps {
  /** Whether the value can be cleared */
  clearable: true;
  onChange: (date: Date | undefined) => void;
}

interface DateTimePickerNonClearableProps extends DateTimePickerBaseProps {
  /** Whether the value can be cleared */
  clearable?: false;
  onChange: (date: Date) => void;
}

export type DateTimePickerProps = DateTimePickerClearableProps | DateTimePickerNonClearableProps;

/**
 * Date and time as a pair of typeable fields over one shared panel — calendar
 * on the left, quarter-hour rail on the right. A day click keeps the panel for
 * the time half; a time click saves and closes.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  id,
  label,
  required,
  clearable = false,
  minDate,
  maxDate,
  timeFormat,
  ref
}: DateTimePickerProps) {
  return (
    <DateTimeField
      variant="datetime"
      value={value}
      onChange={onChange as (value: any) => void}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      clearable={clearable}
      id={id}
      label={label}
      required={required}
      minDate={minDate}
      maxDate={maxDate}
      timeFormat={timeFormat}
      ref={ref}
    />
  );
}
