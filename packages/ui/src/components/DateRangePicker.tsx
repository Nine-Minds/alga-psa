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
          value={value.from ? new Date(value.from) : undefined}
          onChange={(date) => onChange({
            ...value,
            from: date ? date.toISOString().split('T')[0] : ''
          })}
          placeholder={fromPlaceholder ?? t('form.fromDate', { defaultValue: 'From date' })}
          className={datePickerClassName}
        />
        <DatePicker
          id={id ? `${id}-to` : undefined}
          value={value.to ? new Date(value.to) : undefined}
          onChange={(date) => onChange({
            ...value,
            to: date ? date.toISOString().split('T')[0] : ''
          })}
          placeholder={toPlaceholder ?? t('form.toDate', { defaultValue: 'To date' })}
          className={datePickerClassName}
        />
      </div>
    </div>
  );
};
