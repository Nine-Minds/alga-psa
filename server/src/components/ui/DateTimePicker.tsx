import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { DateTimePickerComponent } from 'server/src/types/ui-reflection/types';
import { Calendar } from 'server/src/components/ui/Calendar';
import { cn } from 'server/src/lib/utils';

export interface DateTimePickerProps {
  value?: Date;
  onChange: (date: Date) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Human-readable label for accessibility */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Minimum allowed date */
  minDate?: Date;
  /** Maximum allowed date */
  maxDate?: Date;
  /** Time format preference */
  timeFormat?: '12h' | '24h';
}

export const DateTimePicker = React.forwardRef<HTMLDivElement, DateTimePickerProps>(
  ({ 
    value, 
    onChange, 
    placeholder = 'Select date and time', 
    className, 
    disabled,
    id,
    label,
    required,
    minDate,
    maxDate,
    timeFormat = '12h'
  }, ref) => {
    const [open, setOpen] = React.useState(false);
    const hourListRef = React.useRef<HTMLDivElement>(null);
    const minuteListRef = React.useRef<HTMLDivElement>(null);
    
    const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(value);
    const [selectedHour, setSelectedHour] = React.useState(
      value ? format(value, timeFormat === '12h' ? 'hh' : 'HH') : '12'
    );
    const [selectedMinute, setSelectedMinute] = React.useState(
      value ? format(value, 'mm') : '00'
    );
    const [period, setPeriod] = React.useState<'AM' | 'PM'>(
      value ? (format(value, 'a') as 'AM' | 'PM') : 'AM'
    );
    
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
    const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<DateTimePickerComponent>({
      type: 'dateTimePicker',
      id,
      label: label || placeholder,
      value: value?.toISOString(),
      disabled,
      required,
      actions: ['open', 'select']
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
      if (!selectedDate) return;

      let h = parseInt(hour);
      if (timeFormat === '12h') {
        if (newPeriod === 'PM' && h !== 12) h += 12;
        if (newPeriod === 'AM' && h === 12) h = 0;
      }

      const newDate = new Date(selectedDate);
      newDate.setHours(h);
      newDate.setMinutes(parseInt(minute));
      onChange(newDate);
    };

    const handleDateSelect = (date: Date | undefined) => {
      if (!date) return;
      
      setSelectedDate(date);
      const newDate = new Date(date);
      
      // Preserve the current time when selecting a new date
      if (value) {
        newDate.setHours(value.getHours());
        newDate.setMinutes(value.getMinutes());
      }
      
      onChange(newDate);
    };

    const displayValue = value
      ? format(value, timeFormat === '12h' ? 'MM/dd/yyyy hh:mm a' : 'MM/dd/yyyy HH:mm')
      : placeholder;

    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <div className={className} ref={ref}>
          <Popover.Trigger
            {...automationIdProps}
            disabled={disabled}
            aria-label={label || placeholder}
            className={`
              flex h-10 w-full min-w-[200px] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm
              file:border-0 file:bg-transparent file:text-sm file:font-medium 
              placeholder:text-gray-500
              hover:border-gray-400
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 
              disabled:cursor-not-allowed disabled:opacity-50
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <span className="flex-1 text-left truncate">{displayValue}</span>
            <div className="flex gap-2">
              <Clock className="h-4 w-4 opacity-50" />
            </div>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              className="z-50 w-[480px] p-0 bg-white border border-gray-200 rounded-md shadow-lg animate-in fade-in-0 zoom-in-95"
              align="center"
              side="bottom"
              sideOffset={4}
              avoidCollisions={true}
            >
              <div className="flex flex-row">
                <div className="w-[280px]">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDateSelect}
                    defaultMonth={value}
                    fromDate={minDate}
                    toDate={maxDate}
                  />
                </div>

                <div className="border-l border-gray-200 p-2 w-[200px]">
                  <div className="flex items-start justify-between gap-2">
                    
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Hour</label>
                      <div
                        ref={hourListRef}
                        className="h-[240px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
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
                        className="h-[240px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
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
                </div>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </div>
      </Popover.Root>
    );
  }
);

DateTimePicker.displayName = 'DateTimePicker';
