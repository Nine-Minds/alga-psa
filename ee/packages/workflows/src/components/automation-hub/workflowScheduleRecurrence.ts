export type RecurringBuilderFrequency = 'daily' | 'weekly' | 'monthly';

export type RecurringBuilderState = {
  frequency: RecurringBuilderFrequency;
  time: string;
  weekdays: number[];
  dayOfMonth: string;
};

export const WEEKDAY_OPTIONS: Array<{ value: number; shortLabel: string; longLabel: string }> = [
  { value: 1, shortLabel: 'Mon', longLabel: 'Monday' },
  { value: 2, shortLabel: 'Tue', longLabel: 'Tuesday' },
  { value: 3, shortLabel: 'Wed', longLabel: 'Wednesday' },
  { value: 4, shortLabel: 'Thu', longLabel: 'Thursday' },
  { value: 5, shortLabel: 'Fri', longLabel: 'Friday' },
  { value: 6, shortLabel: 'Sat', longLabel: 'Saturday' },
  { value: 0, shortLabel: 'Sun', longLabel: 'Sunday' },
];

export const DEFAULT_RECURRING_BUILDER_STATE: RecurringBuilderState = {
  frequency: 'daily',
  time: '09:00',
  weekdays: [1],
  dayOfMonth: '1',
};

const weekdaySortOrder = new Map<number, number>(
  WEEKDAY_OPTIONS.map((option, index) => [option.value, index])
);

const normalizeWeekdays = (weekdays: number[]): number[] =>
  Array.from(new Set(weekdays))
    .filter((day) => weekdaySortOrder.has(day))
    .sort((left, right) => (weekdaySortOrder.get(left) ?? 0) - (weekdaySortOrder.get(right) ?? 0));

const parseTime = (time: string): { hour: number; minute: number } | null => {
  const match = /^(\d{2}):(\d{2})$/u.exec(time.trim());
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
};

const parseCronNumber = (value: string, min: number, max: number): number | null => {
  if (!/^\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
};

const normalizeCronWeekday = (value: number): number | null => {
  if (value === 7) {
    return 0;
  }
  return value >= 0 && value <= 6 ? value : null;
};

const expandCronDayOfWeek = (value: string): number[] | null => {
  if (!value.trim()) {
    return null;
  }

  const days = new Set<number>();
  for (const part of value.split(',')) {
    const token = part.trim();
    if (!token) {
      return null;
    }

    if (token.includes('-')) {
      const [startRaw, endRaw] = token.split('-');
      const start = parseCronNumber(startRaw ?? '', 0, 7);
      const end = parseCronNumber(endRaw ?? '', 0, 7);
      if (start == null || end == null) {
        return null;
      }

      const normalizedStart = normalizeCronWeekday(start);
      const normalizedEnd = normalizeCronWeekday(end);
      if (normalizedStart == null || normalizedEnd == null || normalizedStart > normalizedEnd) {
        return null;
      }

      for (let day = normalizedStart; day <= normalizedEnd; day += 1) {
        days.add(day);
      }
      continue;
    }

    const parsed = parseCronNumber(token, 0, 7);
    const normalized = parsed == null ? null : normalizeCronWeekday(parsed);
    if (normalized == null) {
      return null;
    }
    days.add(normalized);
  }

  return normalizeWeekdays(Array.from(days));
};

const joinWithAnd = (values: string[]): string => {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

export const getRecurringBuilderValidationMessage = (
  state: RecurringBuilderState
): string | null => {
  if (!parseTime(state.time)) {
    return 'Choose a valid time.';
  }

  if (state.frequency === 'weekly' && normalizeWeekdays(state.weekdays).length === 0) {
    return 'Choose at least one weekday.';
  }

  if (state.frequency === 'monthly') {
    const dayOfMonth = parseCronNumber(state.dayOfMonth, 1, 31);
    if (dayOfMonth == null) {
      return 'Choose a day of month between 1 and 31.';
    }
  }

  return null;
};

export const buildCronFromRecurringBuilder = (
  state: RecurringBuilderState
): string | null => {
  if (getRecurringBuilderValidationMessage(state)) {
    return null;
  }

  const time = parseTime(state.time);
  if (!time) {
    return null;
  }

  if (state.frequency === 'daily') {
    return `${time.minute} ${time.hour} * * *`;
  }

  if (state.frequency === 'weekly') {
    return `${time.minute} ${time.hour} * * ${normalizeWeekdays(state.weekdays).join(',')}`;
  }

  return `${time.minute} ${time.hour} ${Number(state.dayOfMonth)} * *`;
};

export const parseRecurringBuilderFromCron = (
  cron: string
): RecurringBuilderState | null => {
  const fields = cron.trim().split(/\s+/u);
  if (fields.length !== 5) {
    return null;
  }

  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = fields;
  const minute = parseCronNumber(minuteRaw ?? '', 0, 59);
  const hour = parseCronNumber(hourRaw ?? '', 0, 23);
  if (minute == null || hour == null || monthRaw !== '*') {
    return null;
  }

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (dayOfMonthRaw === '*' && dayOfWeekRaw === '*') {
    return {
      frequency: 'daily',
      time,
      weekdays: [...DEFAULT_RECURRING_BUILDER_STATE.weekdays],
      dayOfMonth: DEFAULT_RECURRING_BUILDER_STATE.dayOfMonth,
    };
  }

  if (dayOfMonthRaw === '*' && dayOfWeekRaw !== '*') {
    const weekdays = expandCronDayOfWeek(dayOfWeekRaw);
    if (!weekdays || weekdays.length === 0) {
      return null;
    }

    return {
      frequency: 'weekly',
      time,
      weekdays,
      dayOfMonth: DEFAULT_RECURRING_BUILDER_STATE.dayOfMonth,
    };
  }

  if (dayOfWeekRaw === '*') {
    const dayOfMonth = parseCronNumber(dayOfMonthRaw, 1, 31);
    if (dayOfMonth == null) {
      return null;
    }

    return {
      frequency: 'monthly',
      time,
      weekdays: [...DEFAULT_RECURRING_BUILDER_STATE.weekdays],
      dayOfMonth: String(dayOfMonth),
    };
  }

  return null;
};

const formatTimeLabel = (time: string): string => {
  const parsed = parseTime(time);
  if (!parsed) {
    return time;
  }

  const date = new Date(Date.UTC(2000, 0, 1, parsed.hour, parsed.minute));
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
};

export const getRecurringBuilderSummary = (
  state: RecurringBuilderState,
  timezone: string
): string | null => {
  if (getRecurringBuilderValidationMessage(state)) {
    return null;
  }

  const timeLabel = formatTimeLabel(state.time);
  const timezoneLabel = timezone.trim() || 'UTC';

  if (state.frequency === 'daily') {
    return `Runs every day at ${timeLabel} ${timezoneLabel}`;
  }

  if (state.frequency === 'weekly') {
    const weekdayLabels = normalizeWeekdays(state.weekdays).map(
      (weekday) => WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.longLabel ?? String(weekday)
    );
    return `Runs every ${joinWithAnd(weekdayLabels)} at ${timeLabel} ${timezoneLabel}`;
  }

  return `Runs on day ${Number(state.dayOfMonth)} of each month at ${timeLabel} ${timezoneLabel}`;
};
