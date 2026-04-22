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
}

export const DateRangePicker = ({
  id,
  label,
  value,
  onChange
}: DateRangePickerProps & AutomationProps) => {
  const { t } = useTranslation();
  return (
    <div id={id} className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2">
        <DatePicker
          id={id ? `${id}-from` : undefined}
          value={value.from}
          onChange={(date) => onChange({ ...value, from: date })}
          placeholder={t('form.fromDate', { defaultValue: 'From date' })}
          className="min-w-[160px]"
        />
        <DatePicker
          id={id ? `${id}-to` : undefined}
          value={value.to}
          onChange={(date) => onChange({ ...value, to: date })}
          placeholder={t('form.toDate', { defaultValue: 'To date' })}
          className="min-w-[160px]"
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
}

export const StringDateRangePicker = ({
  id,
  label,
  value,
  onChange
}: StringDateRangePickerProps & AutomationProps) => {
  const { t } = useTranslation();
  return (
    <div id={id} className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2">
        <DatePicker
          id={id ? `${id}-from` : undefined}
          value={value.from ? new Date(value.from) : undefined}
          onChange={(date) => onChange({
            ...value,
            from: date ? date.toISOString().split('T')[0] : ''
          })}
          placeholder={t('form.fromDate', { defaultValue: 'From date' })}
          className="min-w-[160px]"
        />
        <DatePicker
          id={id ? `${id}-to` : undefined}
          value={value.to ? new Date(value.to) : undefined}
          onChange={(date) => onChange({
            ...value,
            to: date ? date.toISOString().split('T')[0] : ''
          })}
          placeholder={t('form.toDate', { defaultValue: 'To date' })}
          className="min-w-[160px]"
        />
      </div>
    </div>
  );
};
