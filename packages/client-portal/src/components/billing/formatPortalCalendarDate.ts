export function formatPortalCalendarDate(date: string | { toString(): string } | undefined | null): string {
  if (!date) return 'N/A';
  try {
    const raw = date instanceof Date ? date.toISOString() : date.toString();
    const serializedCalendarDate = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)$/.exec(raw)?.[1];
    const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : serializedCalendarDate;
    // PostgreSQL date values are calendar days; ISO timestamps retain their
    // instant semantics by following the existing local-time path. A UTC
    // midnight ISO value is also the JSON serialization of a PG date `Date`.
    if (calendarDate) {
      const [year, month, day] = calendarDate.split('-').map(Number);
      const value = new Date(Date.UTC(year, month - 1, day));
      if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
        return 'Invalid date';
      }
      return new Intl.DateTimeFormat('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }).format(value);
    }
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) return 'Invalid date';
    return new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    }).format(value);
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Invalid date';
  }
}
