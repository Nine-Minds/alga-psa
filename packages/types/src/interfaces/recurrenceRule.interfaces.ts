/**
 * Date-level recurrence rule shared by first-class recurring definitions (recurring tickets).
 *
 * These are plain TypeScript types on purpose. The zod schemas that validate them live in
 * `@alga-psa/shared/lib/recurrence` and are asserted equal to these types at compile time;
 * keeping the types here lets UI packages below `shared` use them, and keeps them correct for
 * consumers compiled with `strict: false` (where `z.infer` marks every key optional).
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'onDate'; date: string }
  | { type: 'afterCount'; count: number };

export interface DailyRule {
  frequency: 'daily';
  interval: number;
  weekdaysOnly: boolean;
  end: RecurrenceEnd;
}

export interface WeeklyRule {
  frequency: 'weekly';
  interval: number;
  weekdays: Weekday[];
  end: RecurrenceEnd;
}

export type MonthlyOn =
  | { type: 'dayOfMonth'; day: number | 'last' }
  | { type: 'nthWeekday'; nth: 1 | 2 | 3 | 4 | 'last'; weekday: Weekday };

export interface MonthlyRule {
  frequency: 'monthly';
  interval: number;
  on: MonthlyOn;
  end: RecurrenceEnd;
}

export interface YearlyRule {
  frequency: 'yearly';
  month: number;
  day: number;
  end: RecurrenceEnd;
}

export type RecurrenceRule = DailyRule | WeeklyRule | MonthlyRule | YearlyRule;
