'use client';

import React, { useCallback } from 'react';
import { WEEKDAYS, type RecurrenceRule, type Weekday } from '@alga-psa/types';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import CustomSelect from '../CustomSelect';
import { DatePicker } from '../DatePicker';
import { Input } from '../Input';
import { Label } from '../Label';
import { useTranslation } from '../../lib/i18n/client';

export interface RecurrenceRuleEditorProps {
  value: RecurrenceRule;
  onChange: (rule: RecurrenceRule) => void;
  /** Prefix for the kebab-case element ids of every control. */
  idPrefix?: string;
  disabled?: boolean;
}

type Frequency = RecurrenceRule['frequency'];
type MonthlyOn = Extract<RecurrenceRule, { frequency: 'monthly' }>['on'];
type EndRule = RecurrenceRule['end'];

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
const NTH_VALUES = [1, 2, 3, 4, 'last'] as const;
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The rule a user gets when they switch frequency; the end condition is carried across. */
export function defaultRuleForFrequency(frequency: Frequency, end: EndRule = { type: 'never' }): RecurrenceRule {
  switch (frequency) {
    case 'daily':
      return { frequency, interval: 1, weekdaysOnly: false, end };
    case 'weekly':
      return { frequency, interval: 1, weekdays: ['mon'], end };
    case 'monthly':
      return { frequency, interval: 1, on: { type: 'dayOfMonth', day: 1 }, end };
    case 'yearly':
      return { frequency, month: 1, day: 1, end };
  }
}

const WEEKDAY_ENGLISH: Record<Weekday, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/** `YYYY-MM-DD` to a local-midnight Date (what the date field works with). */
function toLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

function fromLocalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Edits a date-level `RecurrenceRule` (shared/lib/recurrence): frequency, interval, weekday chips,
 * the monthly "day N / Nth weekday" mode and the end condition. It is controlled and holds no state
 * of its own, so the parent can validate with `recurrenceRuleSchema` and preview with the engine.
 */
export function RecurrenceRuleEditor({ value, onChange, idPrefix = 'recurrence', disabled }: RecurrenceRuleEditorProps) {
  const { t } = useTranslation('features/tickets');
  const label = (key: string, defaultValue: string, vars?: Record<string, unknown>) =>
    t(`recurring.rule.editor.${key}`, { defaultValue, ...vars });
  const weekdayName = (day: Weekday, defaultValue: string) => t(`recurring.rule.weekdays.${day}`, { defaultValue });

  const setEnd = useCallback((end: EndRule) => onChange({ ...value, end } as RecurrenceRule), [onChange, value]);

  const setInterval = (raw: string) => {
    if (value.frequency === 'yearly') return;
    const interval = Math.max(1, Math.min(999, Math.trunc(Number(raw)) || 1));
    onChange({ ...value, interval } as RecurrenceRule);
  };

  const toggleWeekday = (day: Weekday) => {
    if (value.frequency !== 'weekly') return;
    const selected = value.weekdays.includes(day);
    // Never allow an empty selection: the schema requires at least one weekday.
    if (selected && value.weekdays.length === 1) return;
    const weekdays = WEEKDAYS.filter((candidate) =>
      candidate === day ? !selected : value.weekdays.includes(candidate)
    );
    onChange({ ...value, weekdays });
  };

  const setMonthlyMode = (mode: string) => {
    if (value.frequency !== 'monthly') return;
    const on: MonthlyOn = mode === 'nthWeekday' ? { type: 'nthWeekday', nth: 1, weekday: 'mon' } : { type: 'dayOfMonth', day: 1 };
    onChange({ ...value, on });
  };

  const frequencyUnit: Record<Frequency, string> = {
    daily: label('unit.days', 'day(s)'),
    weekly: label('unit.weeks', 'week(s)'),
    monthly: label('unit.months', 'month(s)'),
    yearly: label('unit.years', 'year(s)'),
  };

  const dayOptions = [
    ...DAYS_OF_MONTH.map((day) => ({ value: String(day), label: String(day) })),
    { value: 'last', label: label('lastDay', 'Last day') },
  ];
  const weekdayOptions = WEEKDAYS.map((day) => ({ value: day, label: weekdayName(day, WEEKDAY_ENGLISH[day]) }));

  return (
    <div id={`${idPrefix}-editor`} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40">
          <Label htmlFor={`${idPrefix}-frequency`}>{label('repeats', 'Repeats')}</Label>
          <CustomSelect
            id={`${idPrefix}-frequency`}
            value={value.frequency}
            disabled={disabled}
            onValueChange={(frequency) => onChange(defaultRuleForFrequency(frequency as Frequency, value.end))}
            options={FREQUENCIES.map((frequency) => ({
              value: frequency,
              label: label(`frequency.${frequency}`, frequency.charAt(0).toUpperCase() + frequency.slice(1)),
            }))}
          />
        </div>

        {value.frequency !== 'yearly' && (
          <div className="flex items-end gap-2">
            <div className="w-24">
              <Input
                id={`${idPrefix}-interval`}
                type="number"
                min={1}
                max={999}
                label={label('every', 'Every')}
                value={value.interval}
                disabled={disabled}
                onChange={(event) => setInterval(event.target.value)}
              />
            </div>
            <span className="pb-2 text-sm text-[rgb(var(--color-text-600))]">{frequencyUnit[value.frequency]}</span>
          </div>
        )}
      </div>

      {value.frequency === 'daily' && (
        <Checkbox
          id={`${idPrefix}-weekdays-only`}
          label={label('weekdaysOnly', 'Weekdays only (Monday to Friday)')}
          checked={value.weekdaysOnly}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, weekdaysOnly: event.target.checked, interval: event.target.checked ? 1 : value.interval })
          }
        />
      )}

      {value.frequency === 'weekly' && (
        <div>
          <Label>{label('onDays', 'On')}</Label>
          <div id={`${idPrefix}-weekdays`} role="group" className="mt-1 flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const selected = value.weekdays.includes(day);
              return (
                <Button
                  key={day}
                  id={`${idPrefix}-weekday-${day}`}
                  type="button"
                  size="xs"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => toggleWeekday(day)}
                >
                  {t(`recurring.rule.weekdaysShort.${day}`, { defaultValue: day.charAt(0).toUpperCase() + day.slice(1) })}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {value.frequency === 'monthly' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48">
              <Label htmlFor={`${idPrefix}-monthly-mode`}>{label('monthlyOn', 'On')}</Label>
              <CustomSelect
                id={`${idPrefix}-monthly-mode`}
                value={value.on.type}
                disabled={disabled}
                onValueChange={setMonthlyMode}
                options={[
                  { value: 'dayOfMonth', label: label('mode.dayOfMonth', 'Day of the month') },
                  { value: 'nthWeekday', label: label('mode.nthWeekday', 'Nth weekday') },
                ]}
              />
            </div>

            {value.on.type === 'dayOfMonth' ? (
              <div className="w-32">
                <Label htmlFor={`${idPrefix}-day-of-month`}>{label('day', 'Day')}</Label>
                <CustomSelect
                  id={`${idPrefix}-day-of-month`}
                  value={String(value.on.day)}
                  disabled={disabled}
                  onValueChange={(day) =>
                    onChange({ ...value, on: { type: 'dayOfMonth', day: day === 'last' ? 'last' : Number(day) } })
                  }
                  options={dayOptions}
                />
              </div>
            ) : (
              <>
                <div className="w-32">
                  <Label htmlFor={`${idPrefix}-nth`}>{label('nth', 'Which')}</Label>
                  <CustomSelect
                    id={`${idPrefix}-nth`}
                    value={String(value.on.nth)}
                    disabled={disabled}
                    onValueChange={(nth) => {
                      if (value.on.type !== 'nthWeekday') return;
                      onChange({
                        ...value,
                        on: { ...value.on, nth: nth === 'last' ? 'last' : (Number(nth) as 1 | 2 | 3 | 4) },
                      });
                    }}
                    options={NTH_VALUES.map((nth) => ({
                      value: String(nth),
                      label: t(`recurring.rule.ordinals.${nth}`, { defaultValue: String(nth) }),
                    }))}
                  />
                </div>
                <div className="w-40">
                  <Label htmlFor={`${idPrefix}-nth-weekday`}>{label('weekday', 'Weekday')}</Label>
                  <CustomSelect
                    id={`${idPrefix}-nth-weekday`}
                    value={value.on.weekday}
                    disabled={disabled}
                    onValueChange={(weekday) => {
                      if (value.on.type !== 'nthWeekday') return;
                      onChange({ ...value, on: { ...value.on, weekday: weekday as Weekday } });
                    }}
                    options={weekdayOptions}
                  />
                </div>
              </>
            )}
          </div>
          {value.on.type === 'dayOfMonth' && value.on.day !== 'last' && value.on.day > 28 && (
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {label('clampHint', 'In months with fewer days, the ticket is created on the last day of the month.')}
            </p>
          )}
        </div>
      )}

      {value.frequency === 'yearly' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label htmlFor={`${idPrefix}-year-month`}>{label('month', 'Month')}</Label>
            <CustomSelect
              id={`${idPrefix}-year-month`}
              value={String(value.month)}
              disabled={disabled}
              onValueChange={(month) => onChange({ ...value, month: Number(month) })}
              options={MONTHS.map((month) => ({
                value: String(month),
                label: t(`recurring.rule.months.${month}`, { defaultValue: String(month) }),
              }))}
            />
          </div>
          <div className="w-24">
            <Label htmlFor={`${idPrefix}-year-day`}>{label('day', 'Day')}</Label>
            <CustomSelect
              id={`${idPrefix}-year-day`}
              value={String(value.day)}
              disabled={disabled}
              onValueChange={(day) => onChange({ ...value, day: Number(day) })}
              options={DAYS_OF_MONTH.map((day) => ({ value: String(day), label: String(day) }))}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <Label htmlFor={`${idPrefix}-end-type`}>{label('ends', 'Ends')}</Label>
          <CustomSelect
            id={`${idPrefix}-end-type`}
            value={value.end.type}
            disabled={disabled}
            onValueChange={(type) => {
              if (type === 'onDate') setEnd({ type: 'onDate', date: fromLocalDate(new Date()) });
              else if (type === 'afterCount') setEnd({ type: 'afterCount', count: 10 });
              else setEnd({ type: 'never' });
            }}
            options={[
              { value: 'never', label: label('end.never', 'Never') },
              { value: 'onDate', label: label('end.onDate', 'On a date') },
              { value: 'afterCount', label: label('end.afterCount', 'After a number of tickets') },
            ]}
          />
        </div>
        {value.end.type === 'onDate' && (
          <div className="w-48">
            <Label htmlFor={`${idPrefix}-end-date`}>{label('endDate', 'Last date')}</Label>
            <DatePicker
              id={`${idPrefix}-end-date`}
              value={toLocalDate(value.end.date)}
              disabled={disabled}
              onChange={(date) => setEnd({ type: 'onDate', date: fromLocalDate(date) })}
            />
          </div>
        )}
        {value.end.type === 'afterCount' && (
          <div className="w-32">
            <Input
              id={`${idPrefix}-end-count`}
              type="number"
              min={1}
              max={10000}
              label={label('endCount', 'Occurrences')}
              value={value.end.count}
              disabled={disabled}
              onChange={(event) =>
                setEnd({ type: 'afterCount', count: Math.max(1, Math.min(10000, Math.trunc(Number(event.target.value)) || 1)) })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default RecurrenceRuleEditor;
