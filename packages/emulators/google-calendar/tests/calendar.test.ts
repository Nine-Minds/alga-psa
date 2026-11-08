import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import googleCalendar from '../src/index';
import { cancelledInstance, errorResponse, eventsListResponse, tokenResponse } from './contracts/events';

let host: EmulatorHost;
let base: string;
let control: string;

const MASTER_TITLE = 'Go over advisories in Git @alga';
const ACCESS_TOKEN = 'emulated-access-token';

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [googleCalendar], controlPort: 0, ports: { 'google-calendar': 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports['google-calendar']}`;
  control = `http://127.0.0.1:${started.controlPort}`;
});

afterAll(async () => {
  await host?.stop();
});

beforeEach(async () => {
  await controlPost('reset');
});

async function controlPost(path: string, body = {}) {
  const response = await fetch(`${control}/control/google-calendar/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result;
}

function api(path: string, method = 'GET', body?: unknown, token = ACCESS_TOKEN) {
  return fetch(`${base}/calendar/v3${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function list(query = '') {
  const response = await api(`/calendars/primary/events${query}`);
  const body = await response.json();
  eventsListResponse.parse({ status: response.status, body });
  return body as { items: any[]; nextPageToken?: string; nextSyncToken?: string };
}

async function seedSeries(recurrence: string[], event: Record<string, unknown> = {}) {
  return controlPost('seed/event', {
    event: {
      summary: MASTER_TITLE,
      start: { dateTime: '2026-10-01T10:15:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-01T10:45:00', timeZone: 'America/New_York' },
      recurrence,
      ...event,
    },
  });
}

it('refreshes an access token and rejects an unknown refresh token', async () => {
  const response = await fetch(`${base}/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'emulated-refresh-token' }),
  });
  tokenResponse.parse({ status: response.status, body: await response.json() });

  const rejected = await fetch(`${base}/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'revoked' }),
  });
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).error).toBe('invalid_grant');
});

it('requires a known bearer token', async () => {
  const response = await api('/calendars/primary/events', 'GET', undefined, 'nope');
  expect(response.status).toBe(401);
  errorResponse.parse({ status: response.status, body: await response.json() });
});

it('expands an unbounded monthly series to the capped instance count with Google-shaped ids', async () => {
  const master = await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);

  const expanded = await list('?singleEvents=true&maxResults=2500');

  expect(expanded.items).toHaveLength(730);
  expect(expanded.items.every((item) => item.recurringEventId === master.id)).toBe(true);
  expect(expanded.items.every((item) => item.recurrence === undefined)).toBe(true);
  expect(expanded.items[0].id).toBe(`${master.id}_20261001T141500Z`);
  // The series is anchored in America/New_York, so the instant alternates with
  // DST while the local time stays 10:15 (the production fixture).
  expect(expanded.items.slice(0, 3).map((item) => item.start.dateTime)).toEqual([
    '2026-10-01T14:15:00.000Z',
    '2026-11-05T15:15:00.000Z',
    '2026-12-03T15:15:00.000Z',
  ]);
  // The master is never part of a singleEvents listing…
  expect(expanded.items.some((item) => item.id === master.id)).toBe(false);
  // …but it is with singleEvents=false, carrying its rule.
  const stored = await list('?singleEvents=false');
  expect(stored.items).toEqual([expect.objectContaining({ id: master.id, recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'] })]);
});

it('honours a configurable expansion cap and the timeMin/timeMax window', async () => {
  await controlPost('seed/expansion-cap', { cap: 12 });
  await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);

  expect((await list('?singleEvents=true')).items).toHaveLength(12);
  const windowed = await list('?singleEvents=true&timeMin=2026-11-01T00:00:00Z&timeMax=2026-12-31T00:00:00Z');
  expect(windowed.items.map((item) => item.start.dateTime)).toEqual([
    '2026-11-05T15:15:00.000Z',
    '2026-12-03T15:15:00.000Z',
  ]);
});

it('serves an expanded instance by id and through events.instances', async () => {
  const master = await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);
  const instanceId = `${master.id}_20261105T151500Z`;

  const fetched = await api(`/calendars/primary/events/${instanceId}`);
  expect(fetched.status).toBe(200);
  expect(await fetched.json()).toMatchObject({
    id: instanceId,
    recurringEventId: master.id,
    originalStartTime: { dateTime: '2026-11-05T15:15:00.000Z' },
  });

  const instances = await api(`/calendars/primary/events/${master.id}/instances?timeMax=2027-01-01T00:00:00Z`);
  expect(instances.status).toBe(200);
  expect((await instances.json()).items).toHaveLength(3);

  expect((await api('/calendars/primary/events/not-a-real-event')).status).toBe(404);
});

it('reports a cancelled instance as a tombstone and keeps the master', async () => {
  const master = await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);
  await controlPost('seed/cancel-occurrence', { seriesMasterId: master.id, originalStart: '2026-11-05T15:15:00Z' });

  const withoutDeleted = await list('?singleEvents=true&maxResults=5');
  expect(withoutDeleted.items.map((item) => item.start.dateTime)).not.toContain('2026-11-05T15:15:00.000Z');

  const withDeleted = await list('?singleEvents=true&showDeleted=true&maxResults=5');
  const tombstone = withDeleted.items.find((item) => item.id === `${master.id}_20261105T151500Z`);
  cancelledInstance.parse(tombstone);
  expect((await api(`/calendars/primary/events/${master.id}`)).status).toBe(200);
});

it('materializes an edited instance as an exception carrying its original slot', async () => {
  const master = await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);
  const instanceId = `${master.id}_20261203T151500Z`;

  const moved = await api(`/calendars/primary/events/${instanceId}`, 'PATCH', {
    summary: 'Advisories (moved) @alga',
    start: { dateTime: '2026-12-04T15:15:00Z', timeZone: 'America/New_York' },
    end: { dateTime: '2026-12-04T15:45:00Z', timeZone: 'America/New_York' },
  });
  expect(moved.status).toBe(200);

  const expanded = await list('?singleEvents=true&maxResults=5');
  expect(expanded.items).toEqual(expect.arrayContaining([expect.objectContaining({
    id: instanceId,
    summary: 'Advisories (moved) @alga',
    recurringEventId: master.id,
    originalStartTime: expect.objectContaining({ dateTime: '2026-12-03T15:15:00.000Z' }),
    start: expect.objectContaining({ dateTime: '2026-12-04T15:15:00Z' }),
  })]));
});

it('treats a split-series _R master as a separate master', async () => {
  const original = await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH;UNTIL=20261201T000000Z']);
  const split = await controlPost('seed/event', {
    event: {
      id: `${original.id}_R20261105T151500Z`,
      summary: 'Advisories, rescheduled @alga',
      start: { dateTime: '2026-12-10T10:15:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-12-10T10:45:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2TH'],
    },
  });

  const stored = await list('?singleEvents=false');
  expect(stored.items.map((item) => item.id).sort()).toEqual([original.id, split.id].sort());
  const expanded = await list('?singleEvents=true&maxResults=2500');
  // Each instance points at the master it actually came from.
  expect(new Set(expanded.items.map((item) => item.recurringEventId))).toEqual(new Set([original.id, split.id]));
});

it('paginates, issues a sync token, and answers 410 once it is expired', async () => {
  await controlPost('seed/expansion-cap', { cap: 5 });
  await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);

  const first = await list('?singleEvents=true&maxResults=2');
  expect(first.items).toHaveLength(2);
  expect(first.nextSyncToken).toBeUndefined();

  // Later pages keep the round's page size and only the last one carries the
  // sync token, so a client must drain them before storing it.
  let page = first;
  let collected = first.items.length;
  while (page.nextPageToken) {
    page = await list(`?singleEvents=true&pageToken=${page.nextPageToken}`);
    collected += page.items.length;
  }
  expect(collected).toBe(5);
  const second = page;
  expect(second.nextSyncToken).toBeTruthy();

  // Nothing changed: an incremental round is empty but still re-issues a token.
  const incremental = await list(`?singleEvents=true&syncToken=${second.nextSyncToken}`);
  expect(incremental.items).toEqual([]);
  expect(incremental.nextSyncToken).toBeTruthy();

  await controlPost('actions/expire-sync-tokens');
  const expired = await api(`/calendars/primary/events?singleEvents=true&syncToken=${incremental.nextSyncToken}`);
  expect(expired.status).toBe(410);
  const body = await expired.json();
  errorResponse.parse({ status: expired.status, body });
  expect(body.error.errors[0].reason).toBe('fullSyncRequired');
});

it('reports only changed instances on an incremental round', async () => {
  await controlPost('seed/expansion-cap', { cap: 3 });
  const master = await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);
  const initial = await list('?singleEvents=true&maxResults=2500');
  expect(initial.items).toHaveLength(3);

  await controlPost('seed/cancel-occurrence', { seriesMasterId: master.id, originalStart: '2026-12-03T15:15:00Z' });

  const incremental = await list(`?singleEvents=true&syncToken=${initial.nextSyncToken}`);
  expect(incremental.items).toEqual([expect.objectContaining({
    id: `${master.id}_20261203T151500Z`,
    status: 'cancelled',
  })]);
});

it('expands an all-day series with date-only instance ids', async () => {
  await controlPost('seed/expansion-cap', { cap: 3 });
  const master = await controlPost('seed/event', {
    event: {
      summary: 'Inventory day @alga',
      start: { date: '2026-10-01' },
      end: { date: '2026-10-02' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
    },
  });

  const expanded = await list('?singleEvents=true');
  expect(expanded.items.map((item) => item.id)).toEqual([
    `${master.id}_20261001`,
    `${master.id}_20261105`,
    `${master.id}_20261203`,
  ]);
  expect(expanded.items[0].start).toEqual({ date: '2026-10-01' });
});

it('drops EXDATE occurrences from the expansion', async () => {
  await controlPost('seed/expansion-cap', { cap: 4 });
  await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH', 'EXDATE:20261105T151500Z']);

  const expanded = await list('?singleEvents=true');
  expect(expanded.items.map((item) => item.start.dateTime)).toEqual([
    '2026-10-01T14:15:00.000Z',
    '2026-12-03T15:15:00.000Z',
    '2027-01-07T15:15:00.000Z',
  ]);
});

it('deletes a single instance as a cancellation and the master outright', async () => {
  await controlPost('seed/expansion-cap', { cap: 3 });
  const master = await seedSeries(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);

  expect((await api(`/calendars/primary/events/${master.id}_20261105T151500Z`, 'DELETE')).status).toBe(204);
  expect((await list('?singleEvents=true')).items).toHaveLength(2);

  expect((await api(`/calendars/primary/events/${master.id}`, 'DELETE')).status).toBe(204);
  expect((await list('?singleEvents=true')).items).toEqual([]);
  expect((await api(`/calendars/primary/events/${master.id}`)).status).toBe(404);
});

it('creates and stops a push channel', async () => {
  const watch = await api('/calendars/primary/events/watch', 'POST', {
    id: 'channel-1', type: 'web_hook', address: 'https://example.test/api/calendar/webhooks/google', token: 'verify',
  });
  expect(watch.status).toBe(200);
  const channel = await watch.json();
  expect(channel).toMatchObject({ kind: 'api#channel', id: 'channel-1' });
  expect(Number(channel.expiration)).toBeGreaterThan(Date.now());

  expect((await api('/channels/stop', 'POST', { id: 'channel-1', resourceId: channel.resourceId })).status).toBe(204);
  expect((await api('/channels/stop', 'POST', { id: 'channel-1', resourceId: channel.resourceId })).status).toBe(404);
});

it('serves calendar metadata and the calendar list', async () => {
  expect(await (await api('/calendars/primary')).json()).toMatchObject({ kind: 'calendar#calendar', id: 'primary' });
  expect((await api('/calendars/missing')).status).toBe(404);
  expect(await (await api('/users/me/calendarList')).json()).toMatchObject({
    items: [expect.objectContaining({ id: 'primary', primary: true })],
  });
});
