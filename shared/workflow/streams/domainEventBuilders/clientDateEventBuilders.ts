const MS_PER_DAY = 86_400_000;
export const DATE_TRIGGER_THRESHOLDS = [90, 60, 30, 7, 0] as const;

function utcDate(value: string | Date): Date {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  return new Date(`${raw}T00:00:00.000Z`);
}

export function computeDateTrigger(date: string | Date, now: string | Date, thresholds: readonly number[] = DATE_TRIGGER_THRESHOLDS): number | null {
  const target = utcDate(date);
  const today = utcDate(now);
  if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return null;
  const daysUntil = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  return thresholds.includes(daysUntil) ? daysUntil : null;
}

export function computeClientAnniversary(params: { createdAt: string | Date; now: string | Date }): { anniversaryDate: string; yearsAsClient: number; daysUntil: number } | null {
  const created = utcDate(params.createdAt);
  const today = utcDate(params.now);
  if (Number.isNaN(created.getTime()) || Number.isNaN(today.getTime()) || created > today) return null;
  const years = today.getUTCFullYear() - created.getUTCFullYear();
  const month = created.getUTCMonth();
  const day = created.getUTCMonth() === 1 && created.getUTCDate() === 29 && !isLeap(today.getUTCFullYear()) ? 28 : created.getUTCDate();
  let anniversary = new Date(Date.UTC(today.getUTCFullYear(), month, day));
  if (anniversary < today) {
    const nextYear = today.getUTCFullYear() + 1;
    anniversary = new Date(Date.UTC(nextYear, month, month === 1 && created.getUTCDate() === 29 && !isLeap(nextYear) ? 28 : created.getUTCDate()));
  }
  const yearsAsClient = anniversary.getUTCFullYear() - created.getUTCFullYear();
  const daysUntil = Math.round((anniversary.getTime() - today.getTime()) / MS_PER_DAY);
  return { anniversaryDate: anniversary.toISOString().slice(0, 10), yearsAsClient, daysUntil };
}

function isLeap(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
