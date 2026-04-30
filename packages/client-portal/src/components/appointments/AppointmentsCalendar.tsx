'use client';

import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toBrowserDate } from './dateUtils';
import type { AppointmentSummary } from './types';

export type CalendarAppointment = AppointmentSummary;

interface AppointmentsCalendarProps {
  appointments: CalendarAppointment[];
  onSelect?: (appointment: CalendarAppointment) => void;
  /**
   * Called when the user clicks the "+" hover action on a day.
   * `date` is the local-day Date the user clicked, with time at 00:00 in the browser TZ.
   * Days before today should typically be ignored by the parent.
   */
  onCreateOnDate?: (date: Date) => void;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function keyForDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function statusColor(status: CalendarAppointment['status']): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'pending':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'declined':
      return 'bg-rose-100 text-rose-800 border-rose-200';
    case 'cancelled':
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

const MAX_VISIBLE_PER_DAY = 2;

export function AppointmentsCalendar({
  appointments,
  onSelect,
  onCreateOnDate,
}: AppointmentsCalendarProps) {
  const { t, i18n } = useTranslation('features/appointments');
  const locale = i18n.language || undefined;
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);

  const today = new Date();
  const todayKey = (() => {
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  const byDay = useMemo(() => {
    const map = new Map<string, Array<{ apt: CalendarAppointment; dt: Date | null }>>();
    for (const apt of appointments) {
      const dt = toBrowserDate(apt.requested_date, apt.requested_time, apt.requester_timezone);
      const fallbackKey =
        typeof apt.requested_date === 'string' ? apt.requested_date.slice(0, 10) : null;
      const keyDate = dt ? keyForDate(dt) : fallbackKey;
      if (!keyDate) continue;
      const list = map.get(keyDate) || [];
      list.push({ apt, dt });
      map.set(keyDate, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.dt?.getTime() ?? 0) - (b.dt?.getTime() ?? 0));
    }
    return map;
  }, [appointments]);

  const grid = useMemo(() => {
    const firstOfMonth = startOfMonth(cursor);
    const leadingBlankDays = firstOfMonth.getDay(); // 0 (Sun) ... 6 (Sat)
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - leadingBlankDays);

    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  const weekdayLabels = useMemo(() => {
    const base = new Date(2024, 0, 7); // Sun
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(locale, { weekday: 'short' });
    });
  }, [locale]);

  const monthLabel = cursor.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  const handleEventClick = (apt: CalendarAppointment) => {
    setOpenDayKey(null);
    onSelect?.(apt);
  };

  const renderEventChip = (
    apt: CalendarAppointment,
    dt: Date | null,
    keySuffix?: string,
  ) => (
    <button
      key={`${apt.appointment_request_id}-${keySuffix ?? 'cell'}`}
      type="button"
      onClick={() => handleEventClick(apt)}
      className={[
        'w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-[rgb(var(--color-primary-300))]',
        statusColor(apt.status),
      ].join(' ')}
      title={apt.service_name}
      aria-label={`${apt.service_name}${dt ? ` at ${dt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}` : ''}`}
    >
      {dt
        ? `${dt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })} · `
        : ''}
      {apt.service_name}
    </button>
  );

  return (
    <div className="flex flex-col" role="region" aria-label={t('calendar.label', 'Appointments calendar')}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-3 border-b border-[rgb(var(--color-border-100))]">
        <div className="flex items-center gap-2">
          <Button
            id="calendar-prev-month"
            variant="outline"
            size="sm"
            aria-label={t('calendar.previousMonth', 'Previous month')}
            onClick={() => setCursor((c) => addMonths(c, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div
            className="min-w-[180px] text-center text-sm font-semibold text-[rgb(var(--color-text-900))]"
            aria-live="polite"
          >
            {monthLabel}
          </div>
          <Button
            id="calendar-next-month"
            variant="outline"
            size="sm"
            aria-label={t('calendar.nextMonth', 'Next month')}
            onClick={() => setCursor((c) => addMonths(c, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          id="calendar-today"
          variant="soft"
          size="sm"
          onClick={() => setCursor(startOfMonth(new Date()))}
        >
          {t('calendar.today', 'Today')}
        </Button>
      </div>

      {/* Weekday labels */}
      <div
        className="grid grid-cols-7 border-b border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-background))]"
        role="row"
      >
        {weekdayLabels.map((w) => (
          <div
            key={w}
            role="columnheader"
            className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-[rgb(var(--color-text-500))]"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        className="grid grid-cols-7 grid-rows-6 flex-1 min-h-[520px]"
        role="grid"
        aria-label={monthLabel}
      >
        {grid.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = isSameDay(d, today);
          const dayKey = keyForDate(d);
          const list = byDay.get(dayKey) || [];
          const visible = list.slice(0, MAX_VISIBLE_PER_DAY);
          const remaining = list.length - visible.length;
          const dayLabel = d.toLocaleDateString(locale, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          });
          const cellAriaLabel = list.length
            ? t('calendar.cellWithCount', {
                defaultValue: '{{date}}, {{count}} appointments',
                date: dayLabel,
                count: list.length,
              })
            : dayLabel;

          // Allow the "+" hover action only for today or future in-month days.
          const isPast = dayKey < todayKey;
          const canCreate = !!onCreateOnDate && inMonth && !isPast;

          return (
            <div
              key={dayKey}
              role="gridcell"
              aria-label={cellAriaLabel}
              data-date={dayKey}
              data-in-month={inMonth ? 'true' : 'false'}
              className={[
                'group relative border-b border-r border-[rgb(var(--color-border-100))] p-1.5 min-h-[90px] flex flex-col',
                inMonth ? 'bg-[rgb(var(--color-card))]' : 'bg-[rgb(var(--color-background))]',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span
                  className={[
                    'inline-flex h-6 w-6 items-center justify-center text-xs',
                    isToday
                      ? 'rounded-full bg-[rgb(var(--color-primary-500))] font-semibold text-white'
                      : inMonth
                        ? 'text-[rgb(var(--color-text-900))]'
                        : 'text-[rgb(var(--color-text-400))]',
                  ].join(' ')}
                  aria-current={isToday ? 'date' : undefined}
                >
                  {d.getDate()}
                </span>
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => onCreateOnDate?.(new Date(d.getFullYear(), d.getMonth(), d.getDate()))}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-300))]"
                    aria-label={t('calendar.requestOnDate', {
                      defaultValue: 'Request appointment on {{date}}',
                      date: dayLabel,
                    })}
                    title={t('calendar.requestOnDate', {
                      defaultValue: 'Request appointment on {{date}}',
                      date: dayLabel,
                    })}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="mt-1 space-y-1">
                {visible.map(({ apt, dt }) => renderEventChip(apt, dt))}
                {remaining > 0 && (
                  <Popover.Root
                    open={openDayKey === dayKey}
                    onOpenChange={(open) => setOpenDayKey(open ? dayKey : null)}
                  >
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        className="px-1.5 text-[10px] text-[rgb(var(--color-primary-600))] hover:underline focus:outline-none focus:ring-1 focus:ring-[rgb(var(--color-primary-300))] rounded"
                        aria-label={t('calendar.moreAria', {
                          defaultValue: 'Show {{count}} more on {{date}}',
                          count: remaining,
                          date: dayLabel,
                        })}
                      >
                        +{remaining} {t('calendar.more', 'more')}
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        side="bottom"
                        align="start"
                        sideOffset={4}
                        className="z-50 w-64 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-2 shadow-lg"
                      >
                        <div className="px-1 pb-2 text-xs font-semibold text-[rgb(var(--color-text-700))]">
                          {dayLabel}
                        </div>
                        <div className="space-y-1">
                          {list.map(({ apt, dt }) => renderEventChip(apt, dt, 'popover'))}
                        </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AppointmentsCalendar;
