import React from 'react';
import { Label } from './Label';
import { Input } from './Input';
import { AutomationProps } from '../../types/ui-reflection/types';

interface DateRange {
  from: string;
  to: string;
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
        <Input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          placeholder="From"
        />
        <Input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          placeholder="To"
        />
      </div>
    </div>
  );
};
