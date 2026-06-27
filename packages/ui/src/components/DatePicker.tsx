'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { Matcher } from 'react-day-picker';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { DatePickerComponent } from '../ui-reflection/types';
import { Calendar } from './Calendar';
import { useOptionalI18n } from '../lib/i18n/client';
import { LOCALE_CONFIG } from '../lib/i18n/config';
import { getDateFnsLocale } from '../lib/dateFnsLocale';
import '../styles/calendar.css';

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

export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  className,
  disabled,
  id,
  label,
  required,
  clearable = false,
  displayFormat,
  minDate,
  maxDate,
  ref
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Constrain selection to [minDate, maxDate] (both inclusive) when bounds are provided.
  // `before`/`after` matchers are exclusive of the boundary date itself, so the bounds stay selectable.
  const disabledMatchers = React.useMemo<Matcher[] | undefined>(() => {
    const matchers: Matcher[] = [];
    if (minDate) matchers.push({ before: minDate });
    if (maxDate) matchers.push({ after: maxDate });
    return matchers.length > 0 ? matchers : undefined;
  }, [minDate, maxDate]);
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? LOCALE_CONFIG.defaultLocale;
  const dateFnsLocale = getDateFnsLocale(locale);

  // Type-safe helper for clearing - only defined when clearable is true
  // This avoids repeated type assertions throughout the component
  const clearValue = React.useMemo(() => {
    if (clearable) {
      // Type assertion is safe here because clearable=true means onChange accepts undefined
      return () => (onChange as (date: Date | undefined) => void)(undefined);
    }
    return undefined;
  }, [clearable, onChange]);

  const handleClear = React.useCallback(() => {
    clearValue?.();
    setOpen(false);
  }, [clearValue, setOpen]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && value && !disabled && clearValue) {
      e.preventDefault();
      clearValue();
    }
  }, [value, disabled, clearValue]);

  // Register with UI reflection system if id is provided
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<DatePickerComponent>({
    type: 'datePicker',
    id,
    label: label || placeholder,
    value: value?.toISOString(),
    disabled,
    required,
  });

  // Update metadata when field props change
  React.useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: value?.toISOString(),
        disabled,
        required
      });
    }
  }, [value, disabled, required, updateMetadata]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={className} ref={ref}>
        <Popover.Trigger
          {...automationIdProps}
          disabled={disabled}
          aria-label={label || placeholder}
          onKeyDown={handleKeyDown}
          className={`
            flex h-9 w-full rounded-lg border border-border bg-[rgb(var(--color-card))] px-3 py-1.5 text-sm
            file:border-0 file:bg-transparent file:text-sm file:font-medium
            placeholder:text-[rgb(var(--color-text-500))]
            hover:border-[rgb(var(--color-border-300))]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-500))] focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-50
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span className="flex-1 min-w-0 text-left truncate">
            {value ? format(value, displayFormat ?? 'P', { locale: dateFnsLocale }) : placeholder}
          </span>
          {clearValue && value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearValue();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  clearValue();
                }
              }}
              className="mr-2 text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-600))] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <CalendarIcon className="h-4 w-4 ml-2 opacity-50 shrink-0" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="calendar-popover-content calendar-container"
            align="start"
            sideOffset={4}
          >
            <div>
              <Calendar
                mode="single"
                selected={value}
                onSelect={(date) => {
                  if (date) {
                    onChange(new Date(date)); // Ensure we pass a new Date object
                    setOpen(false);
                  } else if (clearValue) {
                    // Only allow clearing when clearable is true
                    clearValue();
                  }
                }}
                onClear={clearValue ? handleClear : undefined}
                defaultMonth={value}
                fromDate={minDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1)}
                toDate={maxDate}
                disabled={disabledMatchers}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}
