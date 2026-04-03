/**
 * Format remaining time as a human-readable string.
 *
 * @param minutes - Remaining minutes (can be negative for overdue)
 * @returns Formatted string like "2h 30m" or "45m" or "1d 4h"
 */
export function formatRemainingTime(minutes: number): string {
  const absMinutes = Math.abs(minutes);
  const isOverdue = minutes < 0;
  const prefix = isOverdue ? '-' : '';

  if (absMinutes < 60) {
    return `${prefix}${absMinutes}m`;
  }

  if (absMinutes < 1440) { // Less than 24 hours
    const hours = Math.floor(absMinutes / 60);
    const mins = absMinutes % 60;
    return mins > 0 ? `${prefix}${hours}h ${mins}m` : `${prefix}${hours}h`;
  }

  // 24 hours or more
  const days = Math.floor(absMinutes / 1440);
  const remainingHours = Math.floor((absMinutes % 1440) / 60);
  return remainingHours > 0 ? `${prefix}${days}d ${remainingHours}h` : `${prefix}${days}d`;
}
