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
              flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm
              file:border-0 file:bg-transparent file:text-sm file:font-medium 
              placeholder:text-gray-500
              hover:border-gray-400
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 
              disabled:cursor-not-allowed disabled:opacity-50
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <span className="flex-1 text-left">{displayValue}</span>
            <div className="flex gap-2">
              <CalendarIcon className="h-4 w-4 opacity-50" />
              <Clock className="h-4 w-4 opacity-50" />
            </div>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              className="z-50 w-[280px] p-0 bg-white border border-gray-200 rounded-md shadow-lg animate-in fade-in-0 zoom-in-95"
              align="start"
              sideOffset={4}
            >
              <div className="flex flex-col">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  defaultMonth={value}
                  fromDate={minDate}
                  toDate={maxDate}
                />

                <div className="border-t border-gray-200 p-2">
                  <div className="grid grid-cols-3 gap-1">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Hour</label>
                      <div
                        className="h-[160px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 hover-scroll-container"
                        style={{ willChange: 'transform' }}
                        onWheel={(e) => {
                          const container = e.currentTarget;
                          const { scrollTop, scrollHeight, clientHeight } = container;
                          const delta = e.deltaY > 0 ? 1 : -1;
                          const maxScroll = scrollHeight - clientHeight;
                          
                          const itemHeight = 32; // Actual measured item height
                          let newScroll = scrollTop + delta * (itemHeight / 4);
                          let newIndex = hours.indexOf(selectedHour) + delta;

                          if (newScroll > maxScroll) {
                            newScroll = 0; // Reset to top
                            newIndex = 0;
                          } else if (newScroll < 0) {
                            newScroll = maxScroll;
                            newIndex = hours.length - 1;
                          }

                          container.scrollTo({
                            top: newScroll,
                            behavior: 'smooth'
                          });

                          if (newIndex >= 0 && newIndex < hours.length) {
                            const newHour = hours[newIndex];
                            setSelectedHour(newHour);
                            handleTimeChange(newHour, selectedMinute, period);
                          }
                          
                          e.preventDefault();
                        }}
                      >
                        {hours.map((hour) => (
                          <button
                            key={hour}
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

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Minute</label>
                      <div 
                        className="h-[160px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
                        onWheel={(e) => {
                          const container = e.currentTarget;
                          const { scrollTop, scrollHeight, clientHeight } = container;
                          const delta = e.deltaY > 0 ? 1 : -1;
                          const maxScroll = scrollHeight - clientHeight;
                          
                          const itemHeight = 32; // Actual measured item height
                          let newScroll = scrollTop + delta * (itemHeight / 4);
                          let newIndex = minutes.indexOf(selectedMinute) + delta;

                          if (newScroll > maxScroll) {
                            newScroll = 0; // Reset to top
                            newIndex = 0;
                          } else if (newScroll < 0) {
                            newScroll = maxScroll;
                            newIndex = minutes.length - 1;
                          }

                          container.scrollTo({
                            top: newScroll,
                            behavior: 'smooth'
                          });

                          if (newIndex >= 0 && newIndex < minutes.length) {
                            const newMinute = minutes[newIndex];
                            setSelectedMinute(newMinute);
                            handleTimeChange(selectedHour, newMinute, period);
                          }
                          
                          e.preventDefault();
                        }}
                      >
                        {minutes.map((minute) => (
                          <button
                            key={minute}
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
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-500">Period</label>
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
