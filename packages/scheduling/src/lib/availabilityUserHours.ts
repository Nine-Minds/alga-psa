export interface UserHoursDay {
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
}

export type UserHoursSource = 'saved' | 'partial' | 'draft';

interface StoredUserHoursDay {
  day_of_week?: number | null;
  is_available: boolean;
  start_time?: string | null;
  end_time?: string | null;
}

export function normalizeAvailabilityTime(value: string | null | undefined, fallback: string): string {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

export function buildDefaultUserHours(): Record<number, UserHoursDay> {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [
      day,
      {
        day_of_week: day,
        is_available: day >= 1 && day <= 5,
        start_time: '09:00',
        end_time: '17:00',
      },
    ])
  );
}

export function hydrateUserHours(rows: StoredUserHoursDay[]): {
  hours: Record<number, UserHoursDay>;
  source: UserHoursSource;
} {
  const hours = buildDefaultUserHours();
  const savedDays = new Set<number>();

  for (const row of rows) {
    const day = row.day_of_week;
    if (day === null || day === undefined || day < 0 || day > 6 || savedDays.has(day)) continue;

    savedDays.add(day);
    hours[day] = {
      day_of_week: day,
      is_available: row.is_available,
      start_time: normalizeAvailabilityTime(row.start_time, '09:00'),
      end_time: normalizeAvailabilityTime(row.end_time, '17:00'),
    };
  }

  return {
    hours,
    source: savedDays.size === 0 ? 'draft' : savedDays.size === 7 ? 'saved' : 'partial',
  };
}

export function userHoursToOrderedWeek(hours: Record<number, UserHoursDay>): UserHoursDay[] {
  return Array.from({ length: 7 }, (_, day) => hours[day]);
}
