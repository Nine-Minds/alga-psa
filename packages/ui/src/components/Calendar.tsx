'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronDown, X } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import type { Locale } from 'date-fns';
import { useOptionalI18n } from '../lib/i18n/client';
import { LOCALE_CONFIG } from '../lib/i18n/config';
import { getDateFnsLocale } from '../lib/dateFnsLocale';
import { usePickerText } from '../lib/pickerText';
// Import default styles first, then our overrides
import 'react-day-picker/dist/style.css';
import '../styles/calendar.css';

const normalizeDate = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const isDateBefore = (left: Date, right: Date): boolean => left.getTime() < right.getTime();
const isDateAfter = (left: Date, right: Date): boolean => left.getTime() > right.getTime();

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
  minMonth: Date;
  maxMonth: Date;
  locale: Locale;
}

const MonthYearSelect = ({ value, onChange, minMonth, maxMonth, locale }: MonthYearSelectProps) => {
  const t = usePickerText();
  const [isOpen, setIsOpen] = React.useState(false);
  const [panelYear, setPanelYear] = React.useState(value.getFullYear());
  const containerRef = React.useRef<HTMLDivElement>(null);

  // A single scrolling list of months could only ever run forwards, so a past
  // month was unreachable. A year stepper plus a month grid goes both ways.
  const openPanel = () => {
    setPanelYear(value.getFullYear());
    setIsOpen(true);
  };

  React.useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Close only this panel, not the surrounding popover/dialog.
      event.stopPropagation();
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const months = React.useMemo(
    () => Array.from({ length: 12 }, (_, month) => new Date(panelYear, month, 1)),
    [panelYear]
  );

  const isMonthAllowed = (month: Date) =>
    month.getTime() >= minMonth.getTime() && month.getTime() <= maxMonth.getTime();

  const canGoToPreviousYear = panelYear - 1 >= minMonth.getFullYear();
  const canGoToNextYear = panelYear + 1 <= maxMonth.getFullYear();

  const handleSelect = (date: Date) => {
    onChange(date);
    setIsOpen(false);
  };

  return (
    <div className="calendar-month-year-select" ref={containerRef}>
      <button
        onClick={() => (isOpen ? setIsOpen(false) : openPanel())}
        className="calendar-month-year-button"
        aria-label={t('datePicker.monthAndYear', 'Select month and year')}
        aria-expanded={isOpen}
        type="button"
      >
        {format(value, 'MMMM yyyy', { locale })}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>

      {isOpen && (
        <div className="calendar-month-year-dropdown">
          <div className="calendar-month-year-yearnav">
            <button
              onClick={() => setPanelYear((year) => year - 1)}
              className="rdp-nav_button"
              aria-label={t('datePicker.previousYear', 'Previous year')}
              disabled={!canGoToPreviousYear}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="calendar-month-year-yearlabel">{panelYear}</span>
            <button
              onClick={() => setPanelYear((year) => year + 1)}
              className="rdp-nav_button"
              aria-label={t('datePicker.nextYear', 'Next year')}
              disabled={!canGoToNextYear}
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="calendar-month-year-grid">
            {months.map((month) => (
              <button
                key={month.toISOString()}
                onClick={() => handleSelect(month)}
                disabled={!isMonthAllowed(month)}
                type="button"
                className={cn(
                  'calendar-month-year-option',
                  month.getMonth() === value.getMonth() &&
                    month.getFullYear() === value.getFullYear() &&
                    'selected'
                )}
              >
                {format(month, 'LLL', { locale })}
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
  onClear,
  mode = 'single',
  month,
  ...props
}: CalendarProps) {
  const t = usePickerText();
  const i18n = useOptionalI18n();
  const dateFnsLocale = getDateFnsLocale(i18n?.locale ?? LOCALE_CONFIG.defaultLocale);
  const [monthYear, setMonthYear] = React.useState<Date>(month || selected || new Date());

  // `month` steers the view from outside (the field family moves it as the user
  // types) without taking navigation away from the caption's own controls.
  const monthKey = month ? `${month.getFullYear()}-${month.getMonth()}` : null;
  React.useEffect(() => {
    if (!month) return;
    setMonthYear(new Date(month.getFullYear(), month.getMonth(), 1));
    // month is re-derived from the same key on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);
  const today = React.useMemo(() => normalizeDate(new Date()), []);
  const minMonth = React.useMemo(
    () =>
      props.fromDate
        ? new Date(props.fromDate.getFullYear(), props.fromDate.getMonth(), 1)
        : new Date(today.getFullYear() - 10, 0, 1),
    [props.fromDate, today]
  );
  const maxMonth = React.useMemo(
    () =>
      props.toDate
        ? new Date(props.toDate.getFullYear(), props.toDate.getMonth(), 1)
        : new Date(today.getFullYear() + 10, 11, 1),
    [props.toDate, today]
  );
  const normalizedFromDate = React.useMemo(
    () => (props.fromDate ? normalizeDate(props.fromDate) : undefined),
    [props.fromDate]
  );
  const normalizedToDate = React.useMemo(
    () => (props.toDate ? normalizeDate(props.toDate) : undefined),
    [props.toDate]
  );
  const isTodaySelectable = React.useMemo(() => {
    if (normalizedFromDate && isDateBefore(today, normalizedFromDate)) {
      return false;
    }

    if (normalizedToDate && isDateAfter(today, normalizedToDate)) {
      return false;
    }

    return true;
  }, [normalizedFromDate, normalizedToDate, today]);

  const handleTodayClick = () => {
    setMonthYear(today);

    if (!isTodaySelectable) {
      return;
    }

    onSelect?.(today);
  };

  const previousMonth = new Date(monthYear.getFullYear(), monthYear.getMonth() - 1, 1);
  const nextMonth = new Date(monthYear.getFullYear(), monthYear.getMonth() + 1, 1);

  const handlePreviousMonth = () => setMonthYear(previousMonth);

  const handleNextMonth = () => setMonthYear(nextMonth);

  return (
    <div className="calendar-container">
      <div className="rdp-caption">
        <MonthYearSelect
          value={monthYear}
          onChange={setMonthYear}
          minMonth={minMonth}
          maxMonth={maxMonth}
          locale={dateFnsLocale}
        />
        <div className="rdp-nav">
          <button
            onClick={handlePreviousMonth}
            className="rdp-nav_button"
            aria-label={t('datePicker.previousMonth', 'Previous month')}
            disabled={previousMonth.getTime() < minMonth.getTime()}
            type="button"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={handleNextMonth}
            className="rdp-nav_button"
            aria-label={t('datePicker.nextMonth', 'Next month')}
            disabled={nextMonth.getTime() > maxMonth.getTime()}
            type="button"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* @ts-ignore - DayPicker has complex discriminated union types for mode/selected/onSelect */}
      <DayPicker
        showOutsideDays={showOutsideDays}
        locale={dateFnsLocale}
        className={cn('rdp', className)}
        classNames={{
          ...classNames,
          // v9 renamed `caption`; without the current key the month title
          // rendered a second time under our own caption row.
          month_caption: 'rdp-caption-hidden',
          nav: 'rdp-nav-hidden'
        }}
        mode="single"
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
                aria-label={t('datePicker.clear', 'Clear')}
                type="button"
              >
                <X className="w-4 h-4" />
                {t('datePicker.clear', 'Clear')}
              </button>
            )}
            <button
              onClick={handleTodayClick}
              className="calendar-today-button"
              aria-label={t('datePicker.selectToday', 'Select today')}
              type="button"
              disabled={!isTodaySelectable}
            >
              <ChevronsLeft className="w-4 h-4" />
              {t('datePicker.today', 'Today')}
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
