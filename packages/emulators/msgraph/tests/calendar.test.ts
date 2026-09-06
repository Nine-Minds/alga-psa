import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '../src/index';
import http from 'node:http';

let host: EmulatorHost;
let base: string;
let control: string;
let token: string;
let receiver: http.Server;
let callback: string;
const notifications: Array<{ path: string; body: any }> = [];

async function controlPost(path: string, body = {}) {
  const response = await fetch(`${control}/control/msgraph/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result;
}
function graph(path: string, method = 'GET', body?: unknown) {
  return fetch(`${base}/v1.0${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const event = {
  subject: 'Primary calendar',
  start: { dateTime: '2026-09-20T10:00:00', timeZone: 'UTC' },
  end: { dateTime: '2026-09-20T11:00:00', timeZone: 'UTC' },
};
const range = new URLSearchParams({ $filter: "start/dateTime ge '2026-09-20T09:00:00Z' and end/dateTime le '2026-09-20T12:00:00Z'" });

beforeAll(async () => {
  receiver = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.searchParams.has('validationToken')) {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(url.searchParams.get('validationToken'));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    notifications.push({ path: url.pathname, body: JSON.parse(Buffer.concat(chunks).toString()) });
    if (url.pathname === '/disconnect') { res.destroy(); return; }
    if (url.pathname === '/redirect') res.writeHead(302, { location: `${callback}/followed` }).end();
    else res.writeHead(url.pathname === '/reject' ? 503 : 202).end();
  }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => receiver.once('listening', resolve));
  callback = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;
});
async function signIn(clientId = 'calendar-client') {
  await controlPost('seed/client', { clientId, clientSecret: 'calendar-secret' });
  const redirect = 'http://localhost/callback';
  const authorization = await fetch(`${base}/common/oauth2/v2.0/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'Calendars.ReadWrite' })}`, { redirect: 'manual' });
  expect(authorization.status).toBe(302);
  const code = new URL(authorization.headers.get('location')!).searchParams.get('code')!;
  const response = await fetch(`${base}/common/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: 'calendar-secret', grant_type: 'authorization_code', code, redirect_uri: redirect }),
  });
  expect(response.ok).toBe(true);
  token = (await response.json()).access_token;
}
beforeEach(async () => {
  notifications.length = 0;
  await controlPost('reset');
  await signIn();
});
afterAll(async () => {
  await host?.stop();
  if (receiver) await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()));
});

it('keeps another organizer outside the delegated primary calendar for reads and mutations', async () => {
  const created = await graph('/users/another-organizer/events', 'POST', event);
  expect(created.status).toBe(201);
  const { id } = await created.json();
  expect((await (await graph('/me/calendar/events')).json()).value).toEqual([]);
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const response = await graph(`/me/calendar/events/${id}`, method, method === 'PATCH' ? { subject: 'Changed' } : undefined);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('ErrorItemNotFound');
  }
  const state = await fetch(`${control}/control/msgraph/state/calendar-events`);
  expect((await state.json()).result).toEqual([expect.objectContaining({ id, subject: event.subject })]);
});

it.each<Record<string, string>>([{ $filter: "subject eq 'Primary calendar'" }, { $orderby: 'subject' }])('rejects unsupported query semantics %j', async query => {
  const response = await graph(`/me/calendar/events?${new URLSearchParams(query)}`);
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe('Request_UnsupportedQuery');
});

it('filters UTC wall-clock values independently of the host timezone', async () => {
  expect((await graph('/me/calendar/events', 'POST', event)).status).toBe(201);
  const response = await graph(`/me/calendar/events?${range}`);
  expect(response.status).toBe(200);
  expect((await response.json()).value).toEqual([expect.objectContaining({ subject: event.subject })]);
});

it('rejects non-UTC event filtering rather than reporting misleading empty results', async () => {
  expect((await graph('/me/calendar/events', 'POST', { ...event, start: { ...event.start, timeZone: 'Pacific Standard Time' } })).status).toBe(201);
  const response = await graph(`/me/calendar/events?${range}`);
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe('Request_UnsupportedQuery');
});

const deltaWindow = '/me/calendarView/delta?startDateTime=2026-09-20T10:00:00Z&endDateTime=2026-09-20T12:00:00Z';
async function delta(url = `${base}/v1.0${deltaWindow}`, pageSize = 100) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, prefer: `odata.maxpagesize=${pageSize}` } });
  expect(response.status).toBe(200);
  return response.json();
}
async function createEvent(input: Record<string, unknown> = {}) {
  const response = await graph('/me/calendar/events', 'POST', { ...event, ...input });
  expect(response.status).toBe(201);
  return response.json();
}

it('freezes paginated rounds and reports later updates, deletions and window exits on the next delta link', async () => {
  const first = await createEvent({ subject: 'Overlaps start', start: { dateTime: '2026-09-20T09:00:00', timeZone: 'UTC' } });
  const second = await createEvent({ subject: 'Overlaps end', start: { dateTime: '2026-09-20T11:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-09-20T13:00:00', timeZone: 'UTC' } });
  await createEvent({ subject: 'Outside', start: { dateTime: '2026-09-21T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-09-21T11:00:00', timeZone: 'UTC' } });
  const page1 = await delta(undefined, 1);
  expect(page1.value).toEqual([expect.objectContaining({ id: first.id })]);
  expect(page1['@odata.deltaLink']).toBeUndefined();
  expect(new URL(page1['@odata.nextLink']).searchParams.has('$skiptoken')).toBe(true);
  expect((await graph(`/me/calendar/events/${first.id}`, 'DELETE')).status).toBe(204);
  expect((await graph(`/me/calendar/events/${second.id}`, 'PATCH', { subject: 'Changed between pages' })).status).toBe(200);
  const page2 = await delta(page1['@odata.nextLink']);
  expect(page2.value).toEqual([expect.objectContaining({ id: second.id, subject: 'Overlaps end' })]);
  expect(page2['@odata.nextLink']).toBeUndefined();
  const changed = await delta(page2['@odata.deltaLink']);
  expect(changed.value).toEqual([
    expect.objectContaining({ id: second.id, subject: 'Changed between pages' }),
    { id: first.id, '@removed': { reason: 'deleted' } },
  ]);
  const unchanged = await delta(changed['@odata.deltaLink']);
  expect(unchanged.value).toEqual([]);
  expect((await graph(`/me/calendar/events/${second.id}`, 'PATCH', {
    start: { dateTime: '2026-09-22T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-09-22T11:00:00', timeZone: 'UTC' },
  })).status).toBe(200);
  const moved = await delta(unchanged['@odata.deltaLink']);
  expect(moved.value).toEqual([{ id: second.id, '@removed': { reason: 'deleted' } }]);
  const added = await createEvent({ subject: 'New in next round' });
  expect((await delta(moved['@odata.deltaLink'])).value).toEqual([expect.objectContaining({ id: added.id })]);
});

it('binds delta and page tokens to the OAuth client', async () => {
  await createEvent();
  await createEvent();
  const page1 = await delta(undefined, 1);
  const page2 = await delta(page1['@odata.nextLink']);
  await signIn('different-client');
  for (const url of [page1['@odata.nextLink'], page2['@odata.deltaLink']]) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe('SyncStateNotFound');
  }
});

it('uses UTC for an initial window without an explicit offset', async () => {
  const created = await createEvent();
  const response = await graph(deltaWindow.replaceAll('Z', ''));
  expect(response.status).toBe(200);
  expect((await response.json()).value).toEqual([expect.objectContaining({ id: created.id })]);
});

it('invalidates old delta state on reset and permits a fresh synchronization', async () => {
  const initial = await delta();
  await controlPost('reset');
  await signIn();
  const response = await fetch(initial['@odata.deltaLink'], { headers: { authorization: `Bearer ${token}` } });
  expect(response.status).toBe(410);
  expect((await response.json()).error.code).toBe('SyncStateNotFound');
  expect((await delta()).value).toEqual([]);
});

it.each([
  '/me/calendarView/delta',
  '/me/calendarView/delta?startDateTime=invalid&endDateTime=2026-09-20T12:00:00Z',
  `${deltaWindow}&$select=id`,
  `${deltaWindow}&$deltatoken=invalid`,
])('rejects an invalid or unsupported delta query: %s', async path => {
  expect((await graph(path)).status).toBe(400);
});

it.each([
  { recurrence: { pattern: { type: 'daily', interval: 1 } } },
  { start: { dateTime: '2026-09-20T10:00:00', timeZone: 'Pacific Standard Time' } },
])('rejects unmodeled delta expansion or timezone behavior: %j', async input => {
  await createEvent(input);
  const response = await graph(deltaWindow);
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe('Request_UnsupportedQuery');
});

async function subscribe(path: string, resource: string, changeType = 'created,updated,deleted', expired = false) {
  const response = await graph('/subscriptions', 'POST', {
    resource, changeType, notificationUrl: `${callback}${path}`, clientState: `state-${path}`,
    expirationDateTime: new Date(Date.now() + (expired ? -60000 : 3600000)).toISOString(),
  });
  expect(response.status).toBe(201);
  return response.json();
}

it('routes created/updated/deleted calendar notifications separately from mail, other organizers and expired subscriptions', async () => {
  const all = await subscribe('/calendar', '/me/calendar/events');
  await subscribe('/created', 'me/calendar/events', 'created');
  await subscribe('/mail', '/me/mailFolders/inbox/messages', 'created');
  await subscribe('/other', '/users/another-organizer/events');
  await subscribe('/expired', '/me/calendar/events', 'created,updated,deleted', true);
  const created = await createEvent();
  expect((await graph(`/me/calendar/events/${created.id}`, 'PATCH', { subject: 'Changed' })).status).toBe(200);
  expect((await graph(`/me/calendar/events/${created.id}`, 'DELETE')).status).toBe(204);
  const changes = notifications.filter(x => x.path === '/calendar').map(x => x.body.value[0]);
  expect(changes.map(x => x.changeType)).toEqual(['created', 'updated', 'deleted']);
  for (const change of changes) expect(change).toMatchObject({ subscriptionId: all.id, clientState: 'state-/calendar', resourceData: { id: created.id } });
  expect(notifications.map(x => x.path).sort()).toEqual(['/calendar', '/calendar', '/calendar', '/created']);
  notifications.length = 0;
  await controlPost('seed/message', { subject: 'Mailbox only' });
  expect(notifications.map(x => x.path)).toEqual(['/mail']);
});

it('injects vendor-side changes through controls and exposes callback failures without following redirects', async () => {
  await subscribe('/calendar', '/me/calendar/events');
  await subscribe('/reject', '/me/calendar/events');
  await subscribe('/redirect', '/me/calendar/events');
  const created = await controlPost('actions/calendar-change', { changeType: 'created', event });
  expect(created.deliveries.map((x: any) => [x.status, x.delivered])).toEqual([[202, true], [503, false], [302, false]]);
  expect(notifications.some(x => x.path === '/followed')).toBe(false);
  const sync = await delta();
  expect(sync.value).toEqual([expect.objectContaining({ id: created.event.id })]);
  await controlPost('actions/calendar-change', { changeType: 'updated', eventId: created.event.id, event: { subject: 'Vendor edit' } });
  expect((await (await graph(`/me/calendar/events/${created.event.id}`)).json()).subject).toBe('Vendor edit');
  await controlPost('actions/calendar-change', { changeType: 'deleted', eventId: created.event.id });
  expect((await delta(sync['@odata.deltaLink'])).value).toEqual([{ id: created.event.id, '@removed': { reason: 'deleted' } }]);
  expect(notifications.filter(x => x.path === '/calendar').map(x => x.body.value[0].changeType)).toEqual(['created', 'updated', 'deleted']);
});

it('delivers new mail only to unexpired subscriptions requesting created changes', async () => {
  await subscribe('/mail', '/me/mailFolders/inbox/messages', 'created');
  await subscribe('/updated', '/me/mailFolders/inbox/messages', 'updated,deleted');
  await subscribe('/expired', '/me/mailFolders/inbox/messages', 'created', true);
  await controlPost('seed/message', { subject: 'Scoped mailbox creation' });
  expect(notifications.map(notification => notification.path)).toEqual(['/mail']);
});

it('replays the same mailbox notification with visible HTTP failures and no redirect or message duplication', async () => {
  const message = await controlPost('seed/message', { subject: 'Replay original provider identity' });
  await subscribe('/mail', '/me/mailFolders/inbox/messages', 'created');
  await subscribe('/reject', '/me/mailFolders/inbox/messages', 'created');
  await subscribe('/redirect', '/me/mailFolders/inbox/messages', 'created');
  for (let attempt = 0; attempt < 2; attempt++) {
    const replay = await controlPost('actions/deliver-message', { messageId: message.id });
    expect(replay.message).toEqual(message);
    expect(replay.deliveries.map((delivery: any) => [delivery.status, delivery.delivered]))
      .toEqual([[202, true], [503, false], [302, false]]);
  }
  expect(notifications.map(notification => notification.path).sort())
    .toEqual(['/mail', '/mail', '/redirect', '/redirect', '/reject', '/reject']);
  expect(notifications.every(notification => notification.body.value[0].resourceData.id === message.id)).toBe(true);
  expect((await (await graph('/me/mailFolders/inbox/messages')).json()).value).toEqual([message]);
});

it('reports mailbox callback connection failures without losing the message', async () => {
  const message = await controlPost('seed/message', { subject: 'Recoverable callback outage' });
  await subscribe('/disconnect', '/me/mailFolders/inbox/messages', 'created');
  const replay = await controlPost('actions/deliver-message', { messageId: message.id });
  expect(replay.deliveries).toEqual([expect.objectContaining({ delivered: false, status: null, error: expect.any(String) })]);
  expect((await (await graph(`/me/messages/${message.id}`)).json()).id).toBe(message.id);
});
