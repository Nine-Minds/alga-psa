'use client';

import React, { useState } from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { format } from 'date-fns';
import { Button } from '@alga-psa/ui/components/Button';
import { Calendar } from '@alga-psa/ui/components/Calendar';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

export type DeadlineFilterType = 'before' | 'after' | 'on' | 'between';

export interface DeadlineFilterValue {
  type: DeadlineFilterType;
  date?: Date;
  endDate?: Date; // For 'between' type
}

interface DeadlineFilterProps {
  value?: DeadlineFilterValue;
  onChange: (value: DeadlineFilterValue | undefined) => void;
  placeholder?: string;
  id?: string;
}

export const DeadlineFilter: React.FC<DeadlineFilterProps> = ({
  value,
  onChange,
  placeholder = 'Filter by deadline',
  id = 'deadline-filter'
}) => {
  const [open, setOpen] = useState(false);
  const [filterType, setFilterType] = useState<DeadlineFilterType>(value?.type || 'before');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(value?.date);
  const [selectedEndDate, setSelectedEndDate] = useState<Date | undefined>(value?.endDate);

  const filterTypeOptions = [
    { value: 'before', label: 'Before' },
    { value: 'after', label: 'After' },
    { value: 'on', label: 'On' },
    { value: 'between', label: 'Between' }
  ];

  const handleApply = () => {
    if (selectedDate) {
      onChange({
        type: filterType,
        date: selectedDate,
        endDate: filterType === 'between' ? selectedEndDate : undefined
      });
      setOpen(false);
    }
  };

  const handleClear = () => {
    onChange(undefined);
    setSelectedDate(undefined);
    setSelectedEndDate(undefined);
    setOpen(false);
  };

  const getDisplayText = () => {
    if (!value || !value.date) return placeholder;
    
    const dateStr = format(value.date, 'MM/dd/yyyy');
    switch (value.type) {
      case 'before':
        return `Before ${dateStr}`;
      case 'after':
        return `After ${dateStr}`;
      case 'on':
        return `On ${dateStr}`;
      case 'between':
        return value.endDate 
          ? `Between ${dateStr} - ${format(value.endDate, 'MM/dd/yyyy')}`
          : `From ${dateStr}`;
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="relative inline-block">
        <Popover.Trigger asChild>
          <Button
            id={id}
            variant="outline"
            className="bg-white flex items-center gap-2"
          >
            <CalendarIcon className="h-4 w-4" />
            <span>{getDisplayText()}</span>
          </Button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="z-50 w-auto p-4 mt-1 bg-white border border-gray-200 rounded-md shadow-lg"
            align="start"
            sideOffset={4}
          >
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Filter Type
                </label>
                <CustomSelect
                  options={filterTypeOptions}
                  value={filterType}
                  onValueChange={(value) => setFilterType(value as DeadlineFilterType)}
                  placeholder="Select filter type"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  {filterType === 'between' ? 'Start Date' : 'Date'}
                </label>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  defaultMonth={selectedDate}
                />
              </div>

              {filterType === 'between' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">
                    End Date
                  </label>
                  <Calendar
                    mode="single"
                    selected={selectedEndDate}
                    onSelect={setSelectedEndDate}
                    defaultMonth={selectedEndDate}
                    disabled={(date) => selectedDate ? date < selectedDate : false}
                  />
                </div>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  id={`${id}-clear`}
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear
                </Button>
                <Button
                  id={`${id}-apply`}
                  size="sm"
                  onClick={handleApply}
                  disabled={!selectedDate || (filterType === 'between' && !selectedEndDate)}
                >
                  Apply Filter
                </Button>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
};