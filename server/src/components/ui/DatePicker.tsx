import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { DatePickerComponent } from 'server/src/types/ui-reflection/types';
import { Calendar } from 'server/src/components/ui/Calendar';
import 'server/src/styles/calendar.css';

export interface DatePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Human-readable label for accessibility */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Whether the value can be cleared */
  clearable?: boolean;
  /** Ref for the component */
  ref?: React.Ref<HTMLDivElement>;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  className,
  disabled,
  id,
  label,
  required,
  clearable = false,
  ref
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const handleClear = React.useCallback(() => {
    onChange(undefined);
    setOpen(false);
  }, [onChange]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && value && !disabled) {
      e.preventDefault();
      onChange(undefined);
    }
  }, [value, disabled, onChange]);

  // Register with UI reflection system if id is provided
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<DatePickerComponent>({
    type: 'datePicker',
    id,
    label: label || placeholder,
    value: value?.toISOString(),
    disabled,
    required,
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

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={className} ref={ref}>
        <Popover.Trigger
          {...automationIdProps}
          disabled={disabled}
          aria-label={label || placeholder}
          onKeyDown={handleKeyDown}
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
          <span className="flex-1 text-left">
            {value ? format(value, 'MM/dd/yyyy') : placeholder}
          </span>
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(undefined);
                }
              }}
              className="mr-2 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <CalendarIcon className="h-4 w-4 ml-2 opacity-50 shrink-0" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="calendar-popover-content calendar-container"
            align="start"
            sideOffset={4}
          >
            <div>
              <Calendar
                mode="single"
                selected={value}
                onSelect={(date) => {
                  if (date) {
                    onChange(new Date(date)); // Ensure we pass a new Date object
                    setOpen(false);
                  } else {
                    onChange(undefined);
                  }
                }}
                onClear={clearable ? handleClear : undefined}
                defaultMonth={value}
                fromDate={new Date(new Date().getFullYear(), new Date().getMonth(), 1)}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}
