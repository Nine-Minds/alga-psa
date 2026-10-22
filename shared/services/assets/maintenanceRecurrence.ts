import { dateValueToDate, toPlainDate } from '@alga-psa/core';

/**
 * Computes the next maintenance date from the actual event date. Month-based
 * intervals clamp to the end of the target month (for example Jan 31 → Feb 28).
 */
export function advanceMaintenanceDate(performedAt: string | Date, frequency: string, interval: number): Date {
  if (!Number.isInteger(interval) || interval < 1) throw new Error('Maintenance frequency interval must be at least one');
  if (frequency === 'custom') throw new Error('Custom maintenance frequency cannot be completed until its recurrence is configured');
  // Legacy API callers can still send an instant; preserve its time-of-day
  // after doing the recurrence arithmetic on the calendar date. Plain dates
  // intentionally have no time component and return canonical UTC midnight.
  const sourceInstant = performedAt instanceof Date
    ? performedAt
    : performedAt.includes('T') || performedAt.includes('Z')
      ? dateValueToDate(performedAt)
      : null;
  let date;
  try {
    date = toPlainDate(performedAt);
  } catch {
    throw new Error('Invalid maintenance completion date');
  }
  if (frequency === 'daily') date = date.add({ days: interval });
  else if (frequency === 'weekly') date = date.add({ days: interval * 7 });
  else if (frequency === 'monthly') date = date.add({ months: interval });
  else if (frequency === 'quarterly') date = date.add({ months: interval * 3 });
  else if (frequency === 'yearly') date = date.add({ years: interval });
  else throw new Error(`Unsupported maintenance frequency: ${frequency}`);
  const result = dateValueToDate(date);
  if (sourceInstant && !Number.isNaN(sourceInstant.getTime())) {
    result.setUTCHours(sourceInstant.getUTCHours(), sourceInstant.getUTCMinutes(), sourceInstant.getUTCSeconds(), sourceInstant.getUTCMilliseconds());
  }
  return result;
}
