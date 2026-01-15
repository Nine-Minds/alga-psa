import React from 'react';
import { Label } from './Label';
import { DatePicker } from './DatePicker';
import { AutomationProps } from '../../types/ui-reflection/types';

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

export const DateRangePicker: React.FC<DateRangePickerProps & AutomationProps> = ({
  id,
  label,
  value,
  onChange
}) => {
  return (
    <div id={id} className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2">
        <DatePicker
          id={id ? `${id}-from` : undefined}
          value={value.from}
          onChange={(date) => onChange({ ...value, from: date })}
          placeholder="From date"
          className="min-w-[160px]"
        />
        <DatePicker
          id={id ? `${id}-to` : undefined}
          value={value.to}
          onChange={(date) => onChange({ ...value, to: date })}
          placeholder="To date"
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

export const StringDateRangePicker: React.FC<StringDateRangePickerProps & AutomationProps> = ({
  id,
  label,
  value,
  onChange
}) => {
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
          placeholder="From date"
          className="min-w-[160px]"
        />
        <DatePicker
          id={id ? `${id}-to` : undefined}
          value={value.to ? new Date(value.to) : undefined}
          onChange={(date) => onChange({
            ...value,
            to: date ? date.toISOString().split('T')[0] : ''
          })}
          placeholder="To date"
          className="min-w-[160px]"
        />
      </div>
    </div>
  );
};
