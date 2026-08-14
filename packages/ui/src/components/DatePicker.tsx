'use client';

import * as React from 'react';
import { DateTimeField } from './DateTimeField';

interface DatePickerBaseProps {
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
  /** Fixed date-fns display pattern; overrides the locale-derived format */
  displayFormat?: string;
  /** Earliest selectable date (inclusive). Days before this are disabled and navigation starts here. */
  minDate?: Date;
  /** Latest selectable date (inclusive). Days after this are disabled, including the "Today" shortcut. */
  maxDate?: Date;
  /** Collapse to an icon-only trigger while the component is narrower than 10rem (makes the wrapper a CSS container) */
  collapsible?: boolean;
  /** Ref for the component */
  ref?: React.Ref<HTMLDivElement>;
}

interface DatePickerClearableProps extends DatePickerBaseProps {
  /** Whether the value can be cleared */
  clearable: true;
  onChange: (date: Date | undefined) => void;
}

interface DatePickerNonClearableProps extends DatePickerBaseProps {
  /** Whether the value can be cleared */
  clearable?: false;
  onChange: (date: Date) => void;
}

export type DatePickerProps = DatePickerClearableProps | DatePickerNonClearableProps;

/**
 * The date-only member of the field family: a typeable field over a calendar
 * panel. Everything it can do, the date+time and time-only variants do the
 * same way — see DateTimeField.
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  id,
  label,
  required,
  clearable = false,
  displayFormat,
  minDate,
  maxDate,
  collapsible = false,
  ref
}: DatePickerProps) {
  return (
    <DateTimeField
      variant="date"
      value={value}
      onChange={onChange as (value: Date | string | undefined) => void}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      clearable={clearable}
      id={id}
      label={label}
      required={required}
      displayFormat={displayFormat}
      minDate={minDate}
      maxDate={maxDate}
      collapsible={collapsible}
      ref={ref}
    />
  );
}
