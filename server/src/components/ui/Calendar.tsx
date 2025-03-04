import * as React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronDown } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import type { SelectSingleEventHandler } from 'react-day-picker';
import { cn } from 'server/src/lib/utils';
import { format } from 'date-fns';

interface CalendarProps extends Omit<React.ComponentProps<typeof DayPicker>, 'mode' | 'selected' | 'onSelect'> {
  mode?: 'single';
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
}

interface MonthYearSelectProps {
  value: Date;
  onChange: (date: Date) => void;
  fromDate: Date;
}

const MonthYearSelect = ({ value, onChange, fromDate }: MonthYearSelectProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  
  // Generate all available month/year combinations
  const options = React.useMemo(() => {
    const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const options = [];
    
    // Generate options for the next 10 years
    for (let i = 0; i < 120; i++) {
      options.push(new Date(start));
      start.setMonth(start.getMonth() + 1);
    }
    
    return options;
  }, [fromDate]);

  const handleSelect = (date: Date) => {
    onChange(date);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center text-sm font-medium bg-transparent cursor-pointer hover:bg-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500"
      >
        {format(value, 'MMMM yyyy')}
        <ChevronDown className="ml-1 h-4 w-4 opacity-50" />
      </button>
      
      {isOpen && (
        <div 
          className="absolute z-50 mt-1 w-48 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg month-year-dropdown"
          onWheel={(e) => {
            e.currentTarget.scrollBy({
              top: e.deltaY,
              behavior: 'smooth'
            });
            e.stopPropagation();
          }}
        >
          <div className="scroll-container">
            {options.map((date) => (
            <button
              key={date.toISOString()}
              onClick={() => handleSelect(date)}
              className={cn(
                'w-full px-3 py-1.5 text-left text-sm month-year-option',
                date.getMonth() === value.getMonth() && date.getFullYear() === value.getFullYear() && 'selected'
              )}
            >
              {format(date, 'MMMM yyyy')}
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
};

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  selected,
  onSelect,
  mode = 'single',
  ...props
}: CalendarProps) {
  const CustomWeekdays = () => {
    const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    return (
      <div className="grid grid-cols-7 mb-1">
        {weekdays.map((weekday, index) => (
          <div 
            key={index}
            className="text-xs font-medium text-gray-500 text-center"
          >
            {weekday}
          </div>
        ))}
      </div>
    );
  };
  const [monthYear, setMonthYear] = React.useState<Date>(selected || new Date());
  const fromDate = props.fromDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
//  const toDate = props.toDate || new Date(2050, 11, 31);

  const handleTodayClick = () => {
    const today = new Date();
    setMonthYear(today);
  };

  return (
    <div className="relative">
      <div className="flex justify-between items-center mb-1 px-3 pt-2 gap-2">
        <MonthYearSelect
          value={monthYear}
          onChange={setMonthYear}
          fromDate={fromDate}
        />
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setMonthYear(new Date(monthYear.setMonth(monthYear.getMonth() - 1)))}
            className="h-8 w-8 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={() => setMonthYear(new Date(monthYear.setMonth(monthYear.getMonth() + 1)))}
            className="h-8 w-8 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>
      </div>
      <DayPicker
        showOutsideDays={showOutsideDays}
        className={cn('p-3 select-none', className)}
        classNames={{
          months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
          month: 'space-y-4',
          caption: 'hidden',
          caption_label: 'hidden',
          nav: 'hidden',
          table: 'w-full border-collapse',
          row: 'grid grid-cols-7',
          cell: cn(
            'text-center text-sm relative py-0.5',
            '[&:has([aria-selected])]:bg-purple-50',
            'first:[&:has([aria-selected])]:rounded-l-md',
            'last:[&:has([aria-selected])]:rounded-r-md',
            'focus-within:relative focus-within:z-20'
          ),
          day: cn(
            'h-8 w-8 p-0 font-normal',
            'inline-flex items-center justify-center rounded-md',
            'hover:bg-purple-100 hover:text-purple-900',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2'
          ),
          day_selected: cn(
            'bg-purple-600 text-white',
            'hover:bg-purple-700 hover:text-white',
            'focus:bg-purple-700 focus:text-white'
          ),
          day_today: 'text-purple-600 font-medium',
          day_outside: 'text-muted-foreground opacity-50',
          day_disabled: 'text-muted-foreground opacity-50',
          day_range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
          day_hidden: 'invisible',
          ...classNames,
        }}
        mode={mode}
        selected={selected}
        onSelect={onSelect as SelectSingleEventHandler}
        month={monthYear}
        onMonthChange={setMonthYear}
        modifiers={{ today: new Date() }}
        modifiersStyles={{
          today: { fontWeight: 'bold', color: 'rgb(var(--color-primary-600))' }
        }}
        components={{
          Weekdays: CustomWeekdays,
        }}
        footer={
          <div className="mt-3 flex justify-center">
            <button
              onClick={handleTodayClick}
              className="inline-flex items-center justify-center px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              <ChevronsLeft className="w-4 h-4 mr-1" />
              Today
            </button>
          </div>
        }
        {...props}
      />
    </div>
  );
}

Calendar.displayName = 'Calendar';

export { Calendar };
