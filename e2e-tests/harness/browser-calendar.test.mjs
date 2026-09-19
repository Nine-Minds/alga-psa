import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BROWSER_TIMEZONE, browserCalendarDayStart } from '../fixtures/browser-calendar.mjs';

// react-big-calendar's week view starts on Sunday, and the schedule fetches
// only the week it renders.
const weekStart = (day) => {
  const start = new Date(day);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start.toISOString();
};

test('the anchor follows the browser calendar day whenever it has left the runner\'s UTC day', () => {
  // The instant that took the enterprise browser collection down: a Saturday
  // evening in UTC is already Sunday in Europe/Berlin, so the calendar had
  // moved on to the week of September 20-26 while the runner still read the
  // 19th. An event on the 19th was neither fetched nor rendered.
  const berlinRolledOver = new Date('2026-09-19T22:33:06.000Z');
  assert.equal(browserCalendarDayStart(BROWSER_TIMEZONE, berlinRolledOver).toISOString(), '2026-09-20T00:00:00.000Z');
  assert.notEqual(
    weekStart(browserCalendarDayStart(BROWSER_TIMEZONE, berlinRolledOver)),
    weekStart(new Date('2026-09-19T00:00:00.000Z')),
    'the regression is a week crossing, not just a day crossing',
  );

  // A zone behind UTC diverges at the other end of the day.
  assert.equal(browserCalendarDayStart('America/Los_Angeles', new Date('2026-09-20T04:15:00.000Z')).toISOString(),
    '2026-09-19T00:00:00.000Z');
});

test('the anchor is the browser day itself, at the UTC midnight the product stores date-only entries on', () => {
  for (const instant of ['2026-09-20T00:00:00.000Z', '2026-09-20T11:59:59.999Z', '2026-09-20T21:59:59.999Z']) {
    const anchor = browserCalendarDayStart(BROWSER_TIMEZONE, new Date(instant));
    assert.equal(anchor.toISOString(), '2026-09-20T00:00:00.000Z', `${instant} is September 20 in ${BROWSER_TIMEZONE}`);
  }
  // Same reading, expressed in the browser's own zone, names the same day.
  const now = new Date();
  assert.equal(
    browserCalendarDayStart(BROWSER_TIMEZONE, now).toISOString().slice(0, 10),
    new Intl.DateTimeFormat('en-CA', { timeZone: BROWSER_TIMEZONE }).format(now),
  );
});

test('the calendar journey places its synthetic event with the shared anchor instead of the runner clock', async () => {
  const spec = await readFile(new URL('../tests/microsoft-calendar.spec.ts', import.meta.url), 'utf8');
  assert.match(spec, /import \{ BROWSER_TIMEZONE, browserCalendarDayStart \} from '\.\.\/fixtures\/browser-calendar\.mjs';/);
  // One source of truth: the zone handed to the browser is the zone the event
  // day is derived from, so the two cannot drift apart.
  assert.match(spec, /timezoneId: BROWSER_TIMEZONE/);
  assert.match(spec, /const start = browserCalendarDayStart\(\)/);
  assert.doesNotMatch(spec, /const start = new Date\(\)/);
});
