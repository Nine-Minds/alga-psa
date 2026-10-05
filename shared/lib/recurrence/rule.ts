/**
 * Date-level recurrence rule for first-class recurring definitions (recurring tickets).
 *
 * The engine in this folder works on calendar dates (`YYYY-MM-DD` strings) and never on the
 * server's local time. Wall-clock instants are produced separately by `toZonedInstant`.
 *
 * LEVERAGE: pattern recurrence-engine — schedule entries (shared/utils/recurrenceUtils.ts) and the
 * inline recurrence UI in EntryPopup should eventually move onto this rule type.
 */
import { z } from 'zod';
import {
  WEEKDAYS,
  type DailyRule,
  type MonthlyOn,
  type MonthlyRule,
  type RecurrenceEnd,
  type RecurrenceRule,
  type WeeklyRule,
  type YearlyRule,
} from '@alga-psa/types';

// The rule types live in @alga-psa/types so packages below `shared` (the UI editor) can use them.
export {
  WEEKDAYS,
  type DailyRule,
  type MonthlyOn,
  type MonthlyRule,
  type RecurrenceEnd,
  type RecurrenceRule,
  type WeeklyRule,
  type YearlyRule,
};
export type { Weekday } from '@alga-psa/types';

export const weekdaySchema = z.enum(WEEKDAYS);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date, `YYYY-MM-DD`, that is a real date (rejects 2026-02-30). */
export const dateStringSchema = z
  .string()
  .regex(DATE_RE, 'Expected a date in YYYY-MM-DD format')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  }, 'Not a valid calendar date');

const intervalSchema = z.number().int().min(1).max(999);

export const recurrenceEndSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('never') }),
  z.object({ type: z.literal('onDate'), date: dateStringSchema }),
  z.object({ type: z.literal('afterCount'), count: z.number().int().min(1).max(10000) }),
]);

const endField = recurrenceEndSchema.default({ type: 'never' });

const dailyRuleSchema = z.object({
  frequency: z.literal('daily'),
  interval: intervalSchema,
  weekdaysOnly: z.boolean().default(false),
  end: endField,
});

const weeklyRuleSchema = z.object({
  frequency: z.literal('weekly'),
  interval: intervalSchema,
  weekdays: z
    .array(weekdaySchema)
    .min(1, 'Choose at least one weekday')
    .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique'),
  end: endField,
});

export const monthlyOnSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('dayOfMonth'),
    day: z.union([z.number().int().min(1).max(31), z.literal('last')]),
  }),
  z.object({
    type: z.literal('nthWeekday'),
    nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal('last')]),
    weekday: weekdaySchema,
  }),
]);

const monthlyRuleSchema = z.object({
  frequency: z.literal('monthly'),
  interval: intervalSchema,
  on: monthlyOnSchema,
  end: endField,
});

// Max day for each month in a leap year, so Feb 29 is accepted (it clamps to Feb 28 in other years).
const MAX_DAY_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const yearlyRuleSchema = z.object({
  frequency: z.literal('yearly'),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  end: endField,
});

/**
 * Cross-field checks. Kept out of the individual object schemas so the union can stay a
 * `discriminatedUnion` (readable errors, O(1) dispatch).
 *
 * - Daily "weekdays only" is the "every weekday" pattern: it is only meaningful with interval 1.
 *   With interval > 1 the semantics are ambiguous (every Nth calendar day that happens to be a
 *   weekday vs. every Nth weekday), so the combination is rejected instead of guessing.
 * - Yearly day must exist in the month (Feb 29 is allowed and clamps to Feb 28 in non-leap years).
 */
const inferredRecurrenceRuleSchema = z
  .discriminatedUnion('frequency', [dailyRuleSchema, weeklyRuleSchema, monthlyRuleSchema, yearlyRuleSchema])
  .superRefine((rule, ctx) => {
    if (rule.frequency === 'daily' && rule.weekdaysOnly && rule.interval !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Weekdays-only daily recurrence requires an interval of 1',
        path: ['interval'],
      });
    }
    if (rule.frequency === 'yearly' && rule.day > MAX_DAY_IN_MONTH[rule.month - 1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Day does not exist in the selected month',
        path: ['day'],
      });
    }
  });

/**
 * Compile-time proof that each schema validates exactly its hand-written type (both directions).
 *
 * `DeepRequired` strips the optional markers `z.infer` adds when a package compiles with
 * `strict: false` (this one does), so the comparison means the same thing in every consumer.
 */
type DeepRequired<T> = T extends readonly (infer U)[]
  ? DeepRequired<U>[]
  : T extends object
    ? { [K in keyof T]-?: DeepRequired<T[K]> }
    : T;
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type MatchesSchema<S extends z.ZodTypeAny, T> = Exactly<DeepRequired<z.infer<S>>, T>;
const schemasMatchTypes: [
  MatchesSchema<typeof inferredRecurrenceRuleSchema, RecurrenceRule>,
  MatchesSchema<typeof dailyRuleSchema, DailyRule>,
  MatchesSchema<typeof weeklyRuleSchema, WeeklyRule>,
  MatchesSchema<typeof monthlyRuleSchema, MonthlyRule>,
  MatchesSchema<typeof yearlyRuleSchema, YearlyRule>,
  MatchesSchema<typeof monthlyOnSchema, MonthlyOn>,
  MatchesSchema<typeof recurrenceEndSchema, RecurrenceEnd>,
] = [true, true, true, true, true, true, true];
void schemasMatchTypes;

/**
 * The rule schema, typed with the hand-written output so `.parse()` yields a `RecurrenceRule` even
 * under `strict: false`. The assertion above is what makes this cast safe.
 */
export const recurrenceRuleSchema = inferredRecurrenceRuleSchema as unknown as z.ZodType<
  RecurrenceRule,
  z.ZodTypeDef,
  z.input<typeof inferredRecurrenceRuleSchema>
>;

export type NonBusinessDayPolicy = 'keep' | 'previous' | 'next';
export const NON_BUSINESS_DAY_POLICIES = ['keep', 'previous', 'next'] as const;
export const nonBusinessDayPolicySchema = z.enum(NON_BUSINESS_DAY_POLICIES);

/** Parses and returns a rule, throwing a readable error for invalid input. */
export function parseRecurrenceRule(input: unknown): RecurrenceRule {
  return recurrenceRuleSchema.parse(input);
}
