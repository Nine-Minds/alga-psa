/**
 * Weekly capacity parsing shared by the capacity editor and the server action,
 * so an invalid value is rejected the same way on both sides instead of being
 * silently coerced to "unset".
 */

export const MAX_WEEKLY_CAPACITY_HOURS = 168;

export type WeeklyCapacityRejection = 'not_a_number' | 'negative' | 'above_max';

export type ParsedWeeklyCapacity =
  | { ok: true; value: number | null }
  | { ok: false; reason: WeeklyCapacityRejection };

export function parseWeeklyCapacityHours(input: unknown): ParsedWeeklyCapacity {
  if (input === null || input === undefined) return { ok: true, value: null };

  let raw: number;
  if (typeof input === 'number') {
    raw = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return { ok: true, value: null };
    raw = Number(trimmed);
  } else {
    return { ok: false, reason: 'not_a_number' };
  }

  if (!Number.isFinite(raw)) return { ok: false, reason: 'not_a_number' };
  if (raw < 0) return { ok: false, reason: 'negative' };
  if (raw > MAX_WEEKLY_CAPACITY_HOURS) return { ok: false, reason: 'above_max' };
  return { ok: true, value: Math.round(raw) };
}

export function weeklyCapacityRejectionMessage(reason: WeeklyCapacityRejection): string {
  switch (reason) {
    case 'negative':
      return 'Weekly capacity cannot be negative';
    case 'above_max':
      return `Weekly capacity cannot exceed ${MAX_WEEKLY_CAPACITY_HOURS} hours`;
    default:
      return 'Weekly capacity must be a number of hours';
  }
}
