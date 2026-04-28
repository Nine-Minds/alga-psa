'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { fromZonedTime } from 'date-fns-tz';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface CalendarAppointment {
  appointment_request_id: string;
  service_name: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  requester_timezone?: string | null;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
}

interface AppointmentsCalendarProps {
  appointments: CalendarAppointment[];
  onSelect?: (appointment: CalendarAppointment) => void;
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

function normalizeTime(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 5);
  return null;
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

export function AppointmentsCalendar({
  appointments,
  onSelect,
}: AppointmentsCalendarProps) {
  const { t } = useTranslation('features/appointments');
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));

  const today = new Date();

  const byDay = useMemo(() => {
    const map = new Map<string, Array<{ apt: CalendarAppointment; dt: Date | null }>>();
    for (const apt of appointments) {
      const dateStr = normalizeDate(apt.requested_date);
      const timeStr = normalizeTime(apt.requested_time);
      if (!dateStr) continue;
      let dt: Date | null = null;
      if (timeStr) {
        try {
          const parsed = fromZonedTime(`${dateStr}T${timeStr}:00`, apt.requester_timezone || 'UTC');
          if (!isNaN(parsed.getTime())) dt = parsed;
        } catch {
          /* ignore */
        }
      }
      const keyDate = dt ? keyForDate(dt) : dateStr;
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

    // Build 6 weeks × 7 days = 42 cells
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  const weekdayLabels = useMemo(() => {
    const base = new Date(2024, 0, 7); // Jan 7 2024 is a Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    });
  }, []);

  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-3 border-b border-[rgb(var(--color-border-100))]">
        <div className="flex items-center gap-2">
          <Button
            id="calendar-prev-month"
            variant="outline"
            size="sm"
            onClick={() => setCursor((c) => addMonths(c, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] text-center text-sm font-semibold text-[rgb(var(--color-text-900))]">
            {monthLabel}
          </div>
          <Button
            id="calendar-next-month"
            variant="outline"
            size="sm"
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
      <div className="grid grid-cols-7 border-b border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-background))]">
        {weekdayLabels.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-[rgb(var(--color-text-500))]"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-[520px]">
        {grid.map((d, idx) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = isSameDay(d, today);
          const list = byDay.get(keyForDate(d)) || [];
          const visible = list.slice(0, 2);
          const remaining = list.length - visible.length;

          return (
            <div
              key={idx}
              className={[
                'border-b border-r border-[rgb(var(--color-border-100))] p-1.5 min-h-[90px] flex flex-col',
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
                >
                  {d.getDate()}
                </span>
              </div>

              <div className="mt-1 space-y-1">
                {visible.map(({ apt, dt }) => (
                  <button
                    key={apt.appointment_request_id}
                    type="button"
                    onClick={() => onSelect?.(apt)}
                    className={[
                      'w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] hover:opacity-80',
                      statusColor(apt.status),
                    ].join(' ')}
                    title={apt.service_name}
                  >
                    {dt
                      ? `${dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · `
                      : ''}
                    {apt.service_name}
                  </button>
                ))}
                {remaining > 0 && (
                  <div className="px-1.5 text-[10px] text-[rgb(var(--color-text-500))]">
                    +{remaining} {t('calendar.more', 'more')}
                  </div>
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
