import React from 'react';
import { Label } from './Label';
import { DatePicker } from './DatePicker';
import { AutomationProps } from '../../types/ui-reflection/types';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangePickerProps {
  label?: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export const DateRangePicker: React.FC<DateRangePickerProps & AutomationProps> = ({
  label,
  value,
  onChange
}) => {
  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2">
        <DatePicker
          value={value.from}
          onChange={(date) => onChange({ ...value, from: date })}
          placeholder="From date"
          className="min-w-[160px]"
        />
        <DatePicker
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
  label?: string;
  value: StringDateRange;
  onChange: (range: StringDateRange) => void;
}

export const StringDateRangePicker: React.FC<StringDateRangePickerProps & AutomationProps> = ({
  label,
  value,
  onChange
}) => {
  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2">
        <DatePicker
          value={value.from ? new Date(value.from) : undefined}
          onChange={(date) => onChange({
            ...value,
            from: date ? date.toISOString().split('T')[0] : ''
          })}
          placeholder="From date"
          className="min-w-[160px]"
        />
        <DatePicker
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
