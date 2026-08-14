'use client';

import * as React from 'react';
import { DateTimeField } from './DateTimeField';

export interface TimePickerProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /**
   * @deprecated Typing is no longer a per-caller privilege — every field in the
   * family accepts text. Kept so existing call sites keep compiling.
   */
  allowManualInput?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Human-readable label for accessibility */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Time format preference; when unset, derived from the active locale */
  timeFormat?: '12h' | '24h';
  /** Ref for the component */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * The time-only member of the field family: the same typeable field, over the
 * panel with the calendar pane dropped. Shortcuts like `930p`, `1435` and
 * `2:35 pm` parse everywhere now, not only where a caller opted in.
 */
export function TimePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  id,
  label,
  required,
  timeFormat,
  ref
}: TimePickerProps) {
  return (
    <DateTimeField
      variant="time"
      value={value}
      onChange={onChange as (value: any) => void}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      id={id}
      label={label}
      required={required}
      timeFormat={timeFormat}
      ref={ref}
    />
  );
}
