/**
 * The timezone Playwright gives the browser for calendar journeys. The runner's
 * own clock is UTC, so anything that has to line up with what the calendar
 * renders must be derived from this zone rather than from the runner's date.
 */
export const BROWSER_TIMEZONE = 'Europe/Berlin';

/**
 * UTC midnight of the calendar day the browser is currently showing.
 *
 * The schedule opens on a week view anchored on the browser's today. Between
 * that zone's midnight and UTC midnight the browser and the runner disagree
 * about the date, and when the disagreement straddles a Saturday they disagree
 * about the whole week: an event placed on the runner's date then falls outside
 * the rendered (and fetched) range entirely and never appears.
 *
 * UTC midnight is also the storage form the product uses for date-only entries,
 * so the returned instant doubles as the start of an all-day entry on that day.
 */
export function browserCalendarDayStart(timeZone = BROWSER_TIMEZONE, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const field = (type) => Number(parts.find((part) => part.type === type).value);
  return new Date(Date.UTC(field('year'), field('month') - 1, field('day')));
}
