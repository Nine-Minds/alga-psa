import React from 'react';
import { Label } from './Label';
import { DatePicker } from './DatePicker';
import { AutomationProps } from '../ui-reflection/types';
import { useTranslation } from '../lib/i18n/client';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangePickerProps {
  id?: string;
  label?: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
  containerClassName?: string;
  rangeClassName?: string;
  datePickerClassName?: string;
  fromPlaceholder?: string;
  toPlaceholder?: string;
}

export const DateRangePicker = ({
  id,
  label,
  value,
  onChange,
  containerClassName = 'space-y-2',
  rangeClassName = 'flex gap-2',
  datePickerClassName = 'min-w-[160px]',
  fromPlaceholder,
  toPlaceholder,
}: DateRangePickerProps & AutomationProps) => {
  const { t } = useTranslation();
  return (
    <div id={id} className={containerClassName}>
      {label && <Label>{label}</Label>}
      <div className={rangeClassName}>
        <DatePicker
          id={id ? `${id}-from` : undefined}
          value={value.from}
          onChange={(date) => onChange({ ...value, from: date })}
          placeholder={fromPlaceholder ?? t('form.fromDate', { defaultValue: 'From date' })}
          className={datePickerClassName}
        />
        <DatePicker
          id={id ? `${id}-to` : undefined}
          value={value.to}
          onChange={(date) => onChange({ ...value, to: date })}
          placeholder={toPlaceholder ?? t('form.toDate', { defaultValue: 'To date' })}
          className={datePickerClassName}
        />
      </div>
    </div>
  );
};

// Legacy string-based date range interface for backward compatibility
interface StringDateRange {
  from: string;
  to: string;
}

/**
 * Parse a 'YYYY-MM-DD' calendar day into a LOCAL Date (local midnight).
 *
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, which the DatePicker then renders
 * in local time — shifting the displayed day by one in any non-UTC timezone. Building
 * the Date from explicit local components keeps the day stable regardless of offset.
 */
export function parseLocalYMD(ymd: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format a Date as a 'YYYY-MM-DD' calendar day using its LOCAL components (not UTC). */
export function formatLocalYMD(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

interface StringDateRangePickerProps {
  id?: string;
  label?: string;
  value: StringDateRange;
  onChange: (range: StringDateRange) => void;
  containerClassName?: string;
  rangeClassName?: string;
  datePickerClassName?: string;
  fromPlaceholder?: string;
  toPlaceholder?: string;
}

export const StringDateRangePicker = ({
  id,
  label,
  value,
  onChange,
  containerClassName = 'space-y-2',
  rangeClassName = 'flex gap-2',
  datePickerClassName = 'min-w-[160px]',
  fromPlaceholder,
  toPlaceholder,
}: StringDateRangePickerProps & AutomationProps) => {
  const { t } = useTranslation();
  return (
    <div id={id} className={containerClassName}>
      {label && <Label>{label}</Label>}
      <div className={rangeClassName}>
        <DatePicker
          id={id ? `${id}-from` : undefined}
          value={value.from ? parseLocalYMD(value.from) : undefined}
          onChange={(date) => onChange({
            ...value,
            from: date ? formatLocalYMD(date) : ''
          })}
          placeholder={fromPlaceholder ?? t('form.fromDate', { defaultValue: 'From date' })}
          className={datePickerClassName}
        />
        <DatePicker
          id={id ? `${id}-to` : undefined}
          value={value.to ? parseLocalYMD(value.to) : undefined}
          onChange={(date) => onChange({
            ...value,
            to: date ? formatLocalYMD(date) : ''
          })}
          placeholder={toPlaceholder ?? t('form.toDate', { defaultValue: 'To date' })}
          className={datePickerClassName}
        />
      </div>
    </div>
  );
};
