'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Clock, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { Matcher } from 'react-day-picker';
import { Calendar } from './Calendar';
import { cn } from '../lib/utils';
import { useOptionalI18n } from '../lib/i18n/client';
import { usePickerText } from '../lib/pickerText';
import { LOCALE_CONFIG } from '../lib/i18n/config';
import { getDateFnsLocale } from '../lib/dateFnsLocale';
import { localeUses12HourClock } from '../lib/localeTimeFormat';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import type {
  DatePickerComponent,
  DateTimePickerComponent,
  TimePickerComponent,
} from '../ui-reflection/types';
import {
  buildTimeOptions,
  formatTimeDisplay,
  getDatePlaceholder,
  isExactMinuteOption,
  isValidTimeValue,
  minutesToTime,
  parseDateInput,
  parseTimeInput,
  startOfDay,
  timeToMinutes,
  type TimeFormatPreference,
} from '../lib/dateTimeInput';
import '../styles/calendar.css';

export type DateTimeFieldVariant = 'date' | 'time' | 'datetime';

export interface DateTimeFieldProps {
  /** date → calendar only · time → rail only · datetime → a field pair over one panel */
  variant: DateTimeFieldVariant;
  /** `Date` for date/datetime, `"HH:mm"` for time */
  value?: Date | string;
  onChange: (value: Date | string | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Whether the value can be cleared */
  clearable?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Human-readable label for accessibility */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Earliest selectable date (inclusive) */
  minDate?: Date;
  /** Latest selectable date (inclusive) */
  maxDate?: Date;
  /** Fixed date-fns display pattern; overrides the locale-derived format */
  displayFormat?: string;
  /** Time format preference; when unset, derived from the active locale */
  timeFormat?: TimeFormatPreference;
  /** Rail granularity. Exact minutes stay reachable whatever this is. */
  minuteStep?: number;
  /** Makes the wrapper a CSS container so callers can size it down */
  collapsible?: boolean;
  ref?: React.Ref<HTMLDivElement>;
}

const AUTOMATION_TYPE: Record<DateTimeFieldVariant, 'datePicker' | 'timePicker' | 'dateTimePicker'> = {
  date: 'datePicker',
  time: 'timePicker',
  datetime: 'dateTimePicker',
};

function clampDate(date: Date, minDate?: Date, maxDate?: Date): Date {
  if (minDate && date.getTime() < startOfDay(minDate).getTime()) return startOfDay(minDate);
  if (maxDate && date.getTime() > startOfDay(maxDate).getTime()) return startOfDay(maxDate);
  return date;
}

/**
 * One field, three configurations.
 *
 * The trigger is a real text input in every variant, so a value can always be
 * typed; the popover is an assist, not a required stop. `datetime` renders the
 * date and time halves as a pair sharing a single panel — calendar on the left,
 * quarter-hour rail on the right — and the other two variants are that panel
 * minus the pane they do not need.
 */
export function DateTimeField({
  variant,
  value,
  onChange,
  placeholder,
  className,
  disabled,
  clearable = false,
  id,
  label,
  required,
  minDate,
  maxDate,
  displayFormat,
  timeFormat,
  minuteStep = 15,
  collapsible = false,
  ref,
}: DateTimeFieldProps) {
  const t = usePickerText();
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? LOCALE_CONFIG.defaultLocale;
  const dateFnsLocale = getDateFnsLocale(locale);
  const effectiveTimeFormat: TimeFormatPreference =
    timeFormat ?? (localeUses12HourClock(locale) ? '12h' : '24h');

  const showDate = variant !== 'time';
  const showTime = variant !== 'date';

  const dateValue = showDate ? (value as Date | undefined) : undefined;
  const timeValue = React.useMemo(() => {
    if (variant === 'time') {
      return typeof value === 'string' ? parseTimeInput(value) ?? undefined : undefined;
    }
    return dateValue ? format(dateValue, 'HH:mm') : undefined;
  }, [variant, value, dateValue]);

  const dateDisplay = React.useCallback(
    (date?: Date) => (date ? format(date, displayFormat ?? 'P', { locale: dateFnsLocale }) : ''),
    [displayFormat, dateFnsLocale]
  );
  const timeDisplay = React.useCallback(
    (time?: string) => formatTimeDisplay(time, effectiveTimeFormat),
    [effectiveTimeFormat]
  );

  const [open, setOpen] = React.useState(false);
  const [dateText, setDateText] = React.useState(() => dateDisplay(dateValue));
  const [timeText, setTimeText] = React.useState(() => timeDisplay(timeValue));
  const [dateError, setDateError] = React.useState(false);
  const [timeError, setTimeError] = React.useState(false);

  const fieldsRef = React.useRef<HTMLDivElement>(null);
  const dateInputRef = React.useRef<HTMLInputElement>(null);
  const timeInputRef = React.useRef<HTMLInputElement>(null);
  const railRef = React.useRef<HTMLDivElement>(null);

  const dateValueKey = dateValue ? dateValue.getTime() : 0;
  React.useEffect(() => {
    setDateText(dateDisplay(dateValue ?? undefined));
    setDateError(false);
    // dateValue is re-derived from the same key on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateValueKey, dateDisplay]);

  React.useEffect(() => {
    setTimeText(timeDisplay(timeValue));
    setTimeError(false);
  }, [timeValue, timeDisplay]);

  const relativeWords = React.useMemo(
    () => ({
      today: [t('datePicker.today', 'Today')],
      tomorrow: [t('datePicker.tomorrow', 'Tomorrow')],
      yesterday: [t('datePicker.yesterday', 'Yesterday')],
    }),
    [t]
  );

  // What the panel should show: the text if it parses, otherwise the value.
  const parsedDateText = React.useMemo(
    () => (dateText.trim() ? parseDateInput(dateText, locale, { relativeWords }) : null),
    [dateText, locale, relativeWords]
  );
  const parsedTimeText = React.useMemo(
    () => (timeText.trim() ? parseTimeInput(timeText) : null),
    [timeText]
  );
  const panelDate = parsedDateText ?? (dateValue ? startOfDay(dateValue) : undefined);
  const panelTime = parsedTimeText ?? timeValue;

  const timeOptions = React.useMemo(
    () => buildTimeOptions(panelTime, minuteStep),
    [panelTime, minuteStep]
  );

  const disabledMatchers = React.useMemo<Matcher[] | undefined>(() => {
    const matchers: Matcher[] = [];
    if (minDate) matchers.push({ before: minDate });
    if (maxDate) matchers.push({ after: maxDate });
    return matchers.length > 0 ? matchers : undefined;
  }, [minDate, maxDate]);

  const automationType = AUTOMATION_TYPE[variant];
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<
    DatePickerComponent | TimePickerComponent | DateTimePickerComponent
  >({
    type: automationType,
    id,
    label: label || placeholder,
    value: variant === 'time' ? (value as string | undefined) : dateValue?.toISOString(),
    disabled,
    required,
  } as any);

  React.useEffect(() => {
    updateMetadata?.({
      value: variant === 'time' ? (value as string | undefined) : dateValue?.toISOString(),
      disabled,
      required,
    } as any);
  }, [value, dateValue, variant, disabled, required, updateMetadata]);

  /**
   * Writes a value. Both halves are resolved from the panel state, so text that
   * was typed into the other field but not yet blurred is carried along rather
   * than thrown away.
   */
  const commitValue = React.useCallback(
    (nextDate: Date | undefined, nextTime: string | undefined) => {
      if (variant === 'time') {
        if (nextTime) onChange(nextTime);
        return;
      }

      if (!nextDate) {
        if (clearable) onChange(undefined);
        return;
      }

      const result = new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
      if (showTime) {
        const time = nextTime ?? timeValue ?? '00:00';
        const minutes = isValidTimeValue(time) ? timeToMinutes(time) : 0;
        result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      }
      onChange(result);
    },
    [variant, onChange, clearable, showTime, timeValue]
  );

  const clearFieldValue = React.useCallback(() => {
    if (!clearable) return;
    if (variant === 'time') {
      onChange('');
    } else {
      onChange(undefined);
    }
    setDateText('');
    setTimeText('');
    setDateError(false);
    setTimeError(false);
  }, [clearable, variant, onChange]);

  const commitDateText = React.useCallback(() => {
    const raw = dateText.trim();
    if (!raw) {
      if (dateValue && clearable) {
        clearFieldValue();
      } else {
        setDateText(dateDisplay(dateValue));
      }
      setDateError(false);
      return true;
    }

    const parsed = parseDateInput(raw, locale, { relativeWords });
    if (!parsed) {
      // Bad text never becomes a guess and never becomes empty: the old value stands.
      setDateError(true);
      return false;
    }

    setDateError(false);
    const clamped = clampDate(parsed, minDate, maxDate);
    setDateText(dateDisplay(clamped));
    if (!dateValue || startOfDay(dateValue).getTime() !== clamped.getTime()) {
      commitValue(clamped, panelTime);
    }
    return true;
  }, [
    dateText,
    dateValue,
    clearable,
    clearFieldValue,
    dateDisplay,
    locale,
    relativeWords,
    minDate,
    maxDate,
    commitValue,
    panelTime,
  ]);

  const commitTimeText = React.useCallback(() => {
    const raw = timeText.trim();
    if (!raw) {
      if (timeValue && clearable && variant === 'time') {
        clearFieldValue();
      } else {
        setTimeText(timeDisplay(timeValue));
      }
      setTimeError(false);
      return true;
    }

    const parsed = parseTimeInput(raw);
    if (!parsed) {
      setTimeError(true);
      return false;
    }

    setTimeError(false);
    setTimeText(timeDisplay(parsed));
    if (parsed !== timeValue) {
      commitValue(panelDate ?? startOfDay(new Date()), parsed);
    }
    return true;
  }, [
    timeText,
    timeValue,
    clearable,
    variant,
    clearFieldValue,
    timeDisplay,
    commitValue,
    panelDate,
  ]);

  // Focusing a field opens the panel, so a programmatic re-focus after a commit
  // has to say whether it means to re-open it.
  const skipOpenOnFocusRef = React.useRef(false);
  const focusField = React.useCallback((field: 'date' | 'time', reopen = false) => {
    skipOpenOnFocusRef.current = !reopen;
    const input = field === 'date' ? dateInputRef.current : timeInputRef.current;
    input?.focus();
    input?.select();
    // The same commit that moved focus here also rewrites this field's text, and
    // the re-render leaves the caret at the end. Take the selection again once
    // that has landed, so the next keystroke replaces the value instead of
    // running on after it.
    window.requestAnimationFrame(() => input?.select());
    window.setTimeout(() => {
      skipOpenOnFocusRef.current = false;
    }, 0);
  }, []);

  const handleDaySelect = React.useCallback(
    (day: Date | undefined) => {
      if (!day) return;
      const picked = startOfDay(day);
      setDateError(false);
      setDateText(dateDisplay(picked));
      commitValue(picked, panelTime);

      if (variant === 'datetime') {
        // The time half is still to come, so the panel stays; focus follows.
        focusField('time', true);
      } else {
        setOpen(false);
        focusField('date');
      }
    },
    [dateDisplay, commitValue, panelTime, variant, focusField]
  );

  const handleTimeSelect = React.useCallback(
    (option: string) => {
      setTimeError(false);
      setTimeText(timeDisplay(option));
      commitValue(panelDate ?? startOfDay(new Date()), option);
      setOpen(false);
      focusField('time');
    },
    [timeDisplay, commitValue, panelDate, focusField]
  );

  const stepDate = React.useCallback(
    (days: number, months = 0, years = 0) => {
      const base = panelDate ?? startOfDay(new Date());
      const next = new Date(
        base.getFullYear() + years,
        base.getMonth() + months,
        base.getDate() + days
      );
      setDateError(false);
      setDateText(dateDisplay(clampDate(next, minDate, maxDate)));
      setOpen(true);
    },
    [panelDate, dateDisplay, minDate, maxDate]
  );

  const stepTime = React.useCallback(
    (direction: 1 | -1, exactMinutes?: number) => {
      const base = panelTime && isValidTimeValue(panelTime) ? timeToMinutes(panelTime) : 9 * 60;
      let next: number;
      if (exactMinutes) {
        next = base + direction * exactMinutes;
      } else {
        const step = Math.max(1, Math.floor(minuteStep) || 15);
        next =
          direction > 0
            ? (Math.floor(base / step) + 1) * step
            : (Math.ceil(base / step) - 1) * step;
      }
      setTimeError(false);
      setTimeText(timeDisplay(minutesToTime(next)));
      setOpen(true);
    },
    [panelTime, minuteStep, timeDisplay]
  );

  const handleClearKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!clearable || !(event.key === 'Backspace' || event.key === 'Delete')) return false;
    const input = event.currentTarget;
    const wholeFieldSelected =
      input.value.length > 0 &&
      input.selectionStart === 0 &&
      input.selectionEnd === input.value.length;
    if (!wholeFieldSelected) return false;
    event.preventDefault();
    clearFieldValue();
    return true;
  };

  const handleDateKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (handleClearKey(event)) return;

    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (commitDateText()) setOpen(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        stepDate(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        stepDate(-1);
        break;
      case 'PageDown':
        event.preventDefault();
        stepDate(0, event.shiftKey ? 0 : 1, event.shiftKey ? 1 : 0);
        break;
      case 'PageUp':
        event.preventDefault();
        stepDate(0, event.shiftKey ? 0 : -1, event.shiftKey ? -1 : 0);
        break;
      default:
        break;
    }
  };

  const handleTimeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (handleClearKey(event)) return;

    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (commitTimeText()) setOpen(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        stepTime(1, event.shiftKey ? 5 : undefined);
        break;
      case 'ArrowUp':
        event.preventDefault();
        stepTime(-1, event.shiftKey ? 5 : undefined);
        break;
      default:
        break;
    }
  };

  // Keep the rail centred on the value in play, including while it is typed.
  React.useEffect(() => {
    if (!open || !showTime) return;
    const frame = window.requestAnimationFrame(() => {
      const container = railRef.current;
      const selected = container?.querySelector<HTMLElement>('[data-selected="true"]');
      if (!container || !selected) return;
      container.scrollTop =
        selected.offsetTop - container.clientHeight / 2 + selected.clientHeight / 2;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, showTime, panelTime]);

  const datePlaceholder = showDate
    ? (variant === 'date' ? placeholder : undefined) ?? getDatePlaceholder(locale)
    : undefined;
  const timePlaceholder = showTime
    ? (variant === 'time' ? placeholder : undefined) ?? timeDisplay('09:00')
    : undefined;

  const dateLabel = label || placeholder || t('datePicker.openCalendar', 'Open calendar');
  const timeLabel =
    variant === 'time'
      ? label || placeholder || t('timePicker.placeholder', 'Select time')
      : t('timePicker.placeholder', 'Select time');

  const footerText =
    variant === 'datetime'
      ? t('dateTimePicker.footerBoth', 'Pick a day to keep going, pick a time to save and close')
      : variant === 'date'
        ? t('dateTimePicker.footerDateOnly', 'Pick a day to save and close')
        : t('dateTimePicker.footerTimeOnly', 'Pick a time to save and close');

  const renderField = (field: 'date' | 'time') => {
    const isDateField = field === 'date';
    const hasError = isDateField ? dateError : timeError;
    const text = isDateField ? dateText : timeText;
    const fieldPlaceholder = (isDateField ? datePlaceholder : timePlaceholder) ?? '';
    // In the pair the value is one thing, so it clears from one place: the date half.
    const canClear =
      clearable && !disabled && (variant === 'time' ? !!timeValue : isDateField && !!dateValue);

    return (
      <div
        key={field}
        className={cn(
          'dtf-field',
          hasError && 'dtf-field-error',
          disabled && 'dtf-field-disabled',
          isDateField ? 'dtf-field-date' : 'dtf-field-time'
        )}
      >
        <input
          {...(isDateField || variant === 'time' ? automationIdProps : {})}
          ref={isDateField ? dateInputRef : timeInputRef}
          type="text"
          autoComplete="off"
          // An input's default 20-character intrinsic width is wider than either
          // half of the pair needs, and would push the second field out of a
          // narrow column. Ask for room for the format and no more.
          size={Math.max(7, fieldPlaceholder.length)}
          className="dtf-input"
          value={text}
          disabled={disabled}
          required={required}
          role="combobox"
          aria-haspopup="dialog"
          aria-label={isDateField ? dateLabel : timeLabel}
          aria-invalid={hasError || undefined}
          aria-expanded={open}
          placeholder={isDateField ? datePlaceholder : timePlaceholder}
          onChange={(event) => {
            if (isDateField) {
              setDateText(event.target.value);
              setDateError(false);
            } else {
              setTimeText(event.target.value);
              setTimeError(false);
            }
          }}
          onFocus={(event) => {
            event.target.select();
            if (!disabled && !skipOpenOnFocusRef.current) setOpen(true);
          }}
          onBlur={() => {
            if (isDateField) commitDateText();
            else commitTimeText();
          }}
          onKeyDown={isDateField ? handleDateKeyDown : handleTimeKeyDown}
        />
        {canClear && (
          <button
            type="button"
            className="dtf-field-clear"
            aria-label={t('datePicker.clear', 'Clear')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => clearFieldValue()}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="dtf-field-icon"
          disabled={disabled}
          tabIndex={-1}
          aria-label={
            isDateField
              ? t('datePicker.openCalendar', 'Open calendar')
              : t('timePicker.open', 'Open time picker')
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const next = !open;
            setOpen(next);
            focusField(field, next);
          }}
        >
          {isDateField ? <CalendarIcon className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        </button>
      </div>
    );
  };

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <div className={cn(collapsible && '@container', className)} ref={ref}>
        <Popover.Anchor asChild>
          <div className="dtf-fields" ref={fieldsRef}>
            {showDate && renderField('date')}
            {showTime && renderField('time')}
          </div>
        </Popover.Anchor>

        {(dateError || timeError) && (
          <p className="dtf-error" role="status">
            {dateError
              ? t('dateTimePicker.invalidDate', 'Not a date — kept {{value}}', {
                  value: dateDisplay(dateValue) || t('dateTimePicker.empty', 'nothing'),
                })
              : t('dateTimePicker.invalidTime', 'Not a time — kept {{value}}', {
                  value: timeDisplay(timeValue) || t('dateTimePicker.empty', 'nothing'),
                })}
          </p>
        )}

        <Popover.Portal>
          <Popover.Content
            className={cn('dtf-panel', variant === 'time' && 'dtf-panel-rail-only')}
            align="start"
            side="bottom"
            sideOffset={4}
            avoidCollisions
            aria-label={dateLabel}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              // Moving between the two halves is not "outside" — one panel serves both.
              if (fieldsRef.current?.contains(event.target as Node)) event.preventDefault();
            }}
            onFocusOutside={(event) => {
              if (fieldsRef.current?.contains(event.target as Node)) event.preventDefault();
            }}
          >
            <div className="dtf-panel-body">
              {showDate && (
                <div className="dtf-panel-calendar">
                  <Calendar
                    mode="single"
                    selected={panelDate}
                    month={panelDate}
                    onSelect={handleDaySelect}
                    fromDate={minDate}
                    toDate={maxDate}
                    disabled={disabledMatchers}
                    footer={null}
                  />
                </div>
              )}

              {showTime && (
                <div className="dtf-rail">
                  <div className="dtf-rail-heading">{t('timePicker.heading', 'Time')}</div>
                  <div className="dtf-rail-scroll" ref={railRef} role="listbox" aria-label={timeLabel}>
                    {timeOptions.map((option) => {
                      const selected = option === panelTime;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          data-selected={selected || undefined}
                          data-value={option}
                          className={cn(
                            'dtf-rail-option',
                            selected && 'selected',
                            isExactMinuteOption(option, minuteStep) && 'exact'
                          )}
                          onClick={() => handleTimeSelect(option)}
                        >
                          {timeDisplay(option)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="dtf-footer">
              <span className="dtf-footer-text">{footerText}</span>
              <span className="dtf-footer-actions">
                {showDate && (
                  <button
                    type="button"
                    className="dtf-footer-button"
                    onClick={() => handleDaySelect(clampDate(startOfDay(new Date()), minDate, maxDate))}
                  >
                    {t('datePicker.today', 'Today')}
                  </button>
                )}
                <button
                  type="button"
                  className="dtf-footer-button"
                  aria-label={t('dateTimePicker.close', 'Close')}
                  onClick={() => {
                    setOpen(false);
                    focusField(showDate ? 'date' : 'time');
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Esc
                </button>
              </span>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}
