/**
 * Computes the next maintenance date from the actual event date. Month-based
 * intervals clamp to the end of the target month (for example Jan 31 → Feb 28).
 */
export function advanceMaintenanceDate(performedAt: string | Date, frequency: string, interval: number): Date {
  if (!Number.isInteger(interval) || interval < 1) throw new Error('Maintenance frequency interval must be at least one');
  if (frequency === 'custom') throw new Error('Custom maintenance frequency cannot be completed until its recurrence is configured');
  const date = new Date(performedAt);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid maintenance completion date');
  const result = new Date(date.getTime());
  if (frequency === 'daily') result.setUTCDate(result.getUTCDate() + interval);
  else if (frequency === 'weekly') result.setUTCDate(result.getUTCDate() + interval * 7);
  else if (frequency === 'monthly' || frequency === 'quarterly' || frequency === 'yearly') {
    const months = frequency === 'monthly' ? interval : frequency === 'quarterly' ? interval * 3 : interval * 12;
    const originalDay = result.getUTCDate();
    result.setUTCDate(1); result.setUTCMonth(result.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(originalDay, lastDay));
  } else throw new Error(`Unsupported maintenance frequency: ${frequency}`);
  return result;
}
