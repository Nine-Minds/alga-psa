function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcStartOfDay(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function addDaysUtc(dateString: string, days: number): string {
  const d = utcStartOfDay(dateString);
  d.setUTCDate(d.getUTCDate() + days);
  return toUtcDateString(d);
}

export function getUtcDatesOverlappedByInterval(start: Date, end: Date): string[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const startDate = toUtcDateString(start);
  const endDate = toUtcDateString(new Date(endMs - 1));

  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addDaysUtc(cursor, 1);
  }
  return dates;
}

export function getOverlapHoursForUtcDate(start: Date, end: Date, dateString: string): number {
  const dayStart = utcStartOfDay(dateString).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (endMs <= startMs) return 0;

  const overlapStart = Math.max(startMs, dayStart);
  const overlapEnd = Math.min(endMs, dayEnd);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  return overlapMs / (60 * 60 * 1000);
}

export function didCrossThreshold(params: {
  capacityLimit: number;
  previousBooked: number;
  currentBooked: number;
}): boolean {
  if (params.capacityLimit <= 0) return false;
  return params.previousBooked < params.capacityLimit && params.currentBooked >= params.capacityLimit;
}

export function utcStartOfDayIso(dateString: string): string {
  return utcStartOfDay(dateString).toISOString();
}

