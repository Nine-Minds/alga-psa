import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { DatePickerComponent } from 'server/src/types/ui-reflection/types';
import { Calendar } from 'server/src/components/ui/Calendar';

export interface DatePickerProps {
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
}

export const DatePicker = React.forwardRef<HTMLDivElement, DatePickerProps>(
  ({ value, onChange, placeholder = 'Select date', className, disabled, id, label, required }, ref) => {
    const [open, setOpen] = React.useState(false);
    
    // Register with UI reflection system if id is provided
    const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<DatePickerComponent>({
      type: 'datePicker',
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
            <span className="flex-1 text-left">
              {value ? format(value, 'MM/dd/yyyy') : placeholder}
            </span>
            <CalendarIcon className="h-4 w-4 opacity-50" />
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              className="z-50 w-auto p-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg animate-in fade-in-0 zoom-in-95"
              align="start"
              sideOffset={4}
            >
              <div className="overflow-hidden">
                <Calendar
                  mode="single"
                  selected={value}
                  onSelect={(date) => {
                    if (date) {
                      onChange(new Date(date)); // Ensure we pass a new Date object
                      setOpen(false);
                    }
                  }}
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
);

DatePicker.displayName = 'DatePicker';
