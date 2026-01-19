'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronDown, X } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
// Import default styles first, then our overrides
import 'react-day-picker/dist/style.css';
import '../styles/calendar.css';

interface CalendarProps extends Omit<React.ComponentProps<typeof DayPicker>, 'mode' | 'selected' | 'onSelect'> {
  mode?: 'single';
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  /** Callback when clear button is clicked. If provided, shows a Clear button. */
  onClear?: () => void;
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
  const options = React.useMemo((): Date[] => {
    const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const options: Date[] = [];
    
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
    <div className="calendar-month-year-select">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="calendar-month-year-button"
        aria-label="Select month and year"
        aria-expanded={isOpen}
      >
        {format(value, 'MMMM yyyy')}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
      
      {isOpen && (
        <div 
          className="calendar-month-year-dropdown"
          onWheel={(e) => {
            e.currentTarget.scrollBy({
              top: e.deltaY,
              behavior: 'smooth'
            });
            e.stopPropagation();
          }}
        >
          {options.map((date) => (
            <button
              key={date.toISOString()}
              onClick={() => handleSelect(date)}
              className={cn(
                'calendar-month-year-option',
                date.getMonth() === value.getMonth() && date.getFullYear() === value.getFullYear() && 'selected'
              )}
            >
              {format(date, 'MMMM yyyy')}
            </button>
          ))}
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
  onClear,
  mode = 'single',
  ...props
}: CalendarProps) {
  const [monthYear, setMonthYear] = React.useState<Date>(selected || new Date());
  const fromDate = props.fromDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const handleTodayClick = () => {
    const today = new Date();
    setMonthYear(today);
  };

  const handlePreviousMonth = () => {
    const newDate = new Date(monthYear.getFullYear(), monthYear.getMonth() - 1, 1);
    setMonthYear(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(monthYear.getFullYear(), monthYear.getMonth() + 1, 1);
    setMonthYear(newDate);
  };

  return (
    <div className="calendar-container">
      <div className="rdp-caption">
        <MonthYearSelect
          value={monthYear}
          onChange={setMonthYear}
          fromDate={fromDate}
        />
        <div className="rdp-nav">
          <button
            onClick={handlePreviousMonth}
            className="rdp-nav_button"
            aria-label="Previous month"
            type="button"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={handleNextMonth}
            className="rdp-nav_button"
            aria-label="Next month"
            type="button"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <DayPicker
        showOutsideDays={showOutsideDays}
        className={cn('rdp', className)}
        classNames={{
          ...classNames,
          caption: 'rdp-caption-hidden',
          nav: 'rdp-nav-hidden'
        }}
        mode={mode}
        selected={selected}
        onSelect={onSelect}
        month={monthYear}
        onMonthChange={setMonthYear}
        modifiers={{ today: new Date() }}
        hideNavigation
        footer={
          <div className="flex justify-center gap-2">
            {onClear && (
              <button
                onClick={onClear}
                className="calendar-today-button"
                aria-label="Clear date"
                type="button"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )}
            <button
              onClick={handleTodayClick}
              className="calendar-today-button"
              aria-label="Go to today"
              type="button"
            >
              <ChevronsLeft className="w-4 h-4" />
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
