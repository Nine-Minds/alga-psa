/**
 * Calendar date of a JS Date read from the database, independent of the server
 * time zone. node-postgres hydrates a `date` column as LOCAL midnight, so on a
 * non-UTC server `toISOString().slice(0, 10)` is a day off and the instant is
 * not UTC midnight. A Date that is exactly local midnight (and not UTC midnight)
 * is a date-column value: read it with local components. Anything else is a real
 * instant or a UTC-midnight date: read it in UTC.
 */
export function dbDateObjectToDateOnly(value: Date): string {
  if (isDbLocalMidnightDate(value)) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${String(value.getFullYear()).padStart(4, '0')}-${month}-${day}`;
  }
  return value.toISOString().slice(0, 10);
}

/** True when a database Date is a `date`-column value hydrated at local midnight on a non-UTC server. */
export function isDbLocalMidnightDate(value: Date): boolean {
  const isUtcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0
    && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
  return !isUtcMidnight && value.getHours() === 0 && value.getMinutes() === 0
    && value.getSeconds() === 0 && value.getMilliseconds() === 0;
}
