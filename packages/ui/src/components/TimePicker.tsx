'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { TimePickerComponent } from '../ui-reflection/types';

export interface TimePickerProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Human-readable label for accessibility */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Time format preference */
  timeFormat?: '12h' | '24h';
  /** Ref for the component */
  ref?: React.Ref<HTMLDivElement>;
}

export function TimePicker({
  value,
  onChange,
  placeholder = 'Select time',
  className,
  disabled,
  id,
  label,
  required,
  timeFormat = '12h',
  ref
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const hourListRef = React.useRef<HTMLDivElement>(null);
  const minuteListRef = React.useRef<HTMLDivElement>(null);

  // Parse the value to get hour, minute, and period
  const parseValue = React.useCallback(() => {
    if (!value) return { hour: '12', minute: '00', period: 'AM' as const };

    const [hourStr, minuteStr] = value.split(':');
    const hourNum = parseInt(hourStr);

    if (timeFormat === '24h') {
      return {
        hour: hourStr.padStart(2, '0'),
        minute: minuteStr.padStart(2, '0'),
        period: hourNum >= 12 ? 'PM' as const : 'AM' as const
      };
    } else {
      // 12h format
      return {
        hour: String(hourNum % 12 || 12).padStart(2, '0'),
        minute: minuteStr.padStart(2, '0'),
        period: hourNum >= 12 ? 'PM' as const : 'AM' as const
      };
    }
  }, [value, timeFormat]);

  const { hour: initialHour, minute: initialMinute, period: initialPeriod } = parseValue();

  const [selectedHour, setSelectedHour] = React.useState(initialHour);
  const [selectedMinute, setSelectedMinute] = React.useState(initialMinute);
  const [period, setPeriod] = React.useState<'AM' | 'PM'>(initialPeriod);

  // Update state when value changes externally
  React.useEffect(() => {
    const { hour, minute, period } = parseValue();
    setSelectedHour(hour);
    setSelectedMinute(minute);
    setPeriod(period);
  }, [value, parseValue]);

  // Scroll to selected values when dropdown opens
  React.useEffect(() => {
    if (open) {
      // Use setTimeout to ensure the DOM has updated
      setTimeout(() => {
        // Scroll hour list to selected hour
        if (hourListRef.current) {
          const selectedHourElement = hourListRef.current.querySelector(`button[data-value="${selectedHour}"]`);
          if (selectedHourElement) {
            selectedHourElement.scrollIntoView({ block: 'center', behavior: 'auto' });
          }
        }

        // Scroll minute list to selected minute
        if (minuteListRef.current) {
          const selectedMinuteElement = minuteListRef.current.querySelector(`button[data-value="${selectedMinute}"]`);
          if (selectedMinuteElement) {
            selectedMinuteElement.scrollIntoView({ block: 'center', behavior: 'auto' });
          }
        }
      }, 50);
    }
  }, [open, selectedHour, selectedMinute]);

  // Register with UI reflection system if id is provided
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<TimePickerComponent>({
    type: 'timePicker',
    id,
    label: label || placeholder,
    value,
    disabled,
    required,
  });

  // Update metadata when field props change
  React.useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value,
        disabled,
        required
      });
    }
  }, [value, disabled, required, updateMetadata]);

  const hours = React.useMemo(() => {
    if (timeFormat === '24h') {
      return Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    }
    return Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  }, [timeFormat]);

  const minutes = React.useMemo(() =>
    Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')),
  []);

  const handleTimeChange = (hour: string, minute: string, newPeriod: 'AM' | 'PM') => {
    let h = parseInt(hour);
    if (timeFormat === '12h') {
      if (newPeriod === 'PM' && h !== 12) h += 12;
      if (newPeriod === 'AM' && h === 12) h = 0;
    }
    const formattedHour = String(h).padStart(2, '0');
    onChange(`${formattedHour}:${minute}`);
  };

  const displayValue = React.useMemo(() => {
    if (!value) return placeholder;

    const { hour, minute, period } = parseValue();
    if (timeFormat === '24h') {
      return `${value}`;
    } else {
      return `${hour}:${minute} ${period}`;
    }
  }, [value, placeholder, parseValue, timeFormat]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={className} ref={ref}>
        <Popover.Trigger
          {...automationIdProps}
          disabled={disabled}
          aria-label={label || placeholder}
          className={`
            flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm
            file:border-0 file:bg-transparent file:text-sm file:font-medium
            placeholder:text-gray-500
            hover:border-gray-400
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-500))] focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-50
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span className="flex-1 text-left">{displayValue}</span>
          <Clock className="h-4 w-4 ml-2 opacity-50 shrink-0" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="z-50 w-[240px] p-3 bg-white border border-gray-200 rounded-md shadow-lg animate-in fade-in-0 zoom-in-95"
            align="start"
            sideOffset={4}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Hour</label>
                <div
                  ref={hourListRef}
                  className="h-[160px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
                  onWheel={(e) => {
                    // Standard scrolling behavior
                    const container = e.currentTarget;
                    const scrollAmount = e.deltaY;
                    container.scrollTop += scrollAmount;
                  }}
                >
                  {hours.map((hour) => (
                    <button
                      key={hour}
                      data-value={hour}
                      onClick={() => {
                        setSelectedHour(hour);
                        handleTimeChange(hour, selectedMinute, period);
                      }}
                      className={cn(
                        'w-full px-2 py-1 text-left text-sm rounded-md text-center',
                        selectedHour === hour
                          ? 'bg-purple-100 text-purple-900'
                          : 'hover:bg-gray-100'
                      )}
                    >
                      {hour}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Minute</label>
                <div
                  ref={minuteListRef}
                  className="h-[160px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
                  onWheel={(e) => {
                    // Standard scrolling behavior
                    const container = e.currentTarget;
                    const scrollAmount = e.deltaY;
                    container.scrollTop += scrollAmount;
                  }}
                >
                  {minutes.map((minute) => (
                    <button
                      key={minute}
                      data-value={minute}
                      onClick={() => {
                        setSelectedMinute(minute);
                        handleTimeChange(selectedHour, minute, period);
                      }}
                      className={cn(
                        'w-full px-2 py-1 text-left text-sm rounded-md text-center',
                        selectedMinute === minute
                          ? 'bg-purple-100 text-purple-900'
                          : 'hover:bg-gray-100'
                      )}
                    >
                      {minute}
                    </button>
                  ))}
                </div>
              </div>

              {timeFormat === '12h' && (
                <div className="w-16">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
                  <div>
                    {(['AM', 'PM'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setPeriod(p);
                          handleTimeChange(selectedHour, selectedMinute, p);
                        }}
                        className={cn(
                          'w-full px-2 py-1 text-left text-sm rounded-md text-center',
                          period === p
                            ? 'bg-purple-100 text-purple-900'
                            : 'hover:bg-gray-100'
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Hidden input for native time support */}
            <input
              type="time"
              value={value || ''}
              onChange={handleInputChange}
              className="sr-only"
              tabIndex={-1}
            />
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}
