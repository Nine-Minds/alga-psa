import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '../src/index';

let host: EmulatorHost;
let base: string;
let control: string;
let token: string;

async function controlPost(path: string, body = {}) {
  const response = await fetch(`${control}/control/msgraph/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  expect((await response.json()).ok).toBe(true);
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
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;
});
beforeEach(async () => {
  await controlPost('reset');
  await controlPost('seed/client', { clientId: 'calendar-client', clientSecret: 'calendar-secret' });
  const redirect = 'http://localhost/callback';
  const authorization = await fetch(`${base}/common/oauth2/v2.0/authorize?${new URLSearchParams({ client_id: 'calendar-client', redirect_uri: redirect, response_type: 'code', scope: 'Calendars.ReadWrite' })}`, { redirect: 'manual' });
  expect(authorization.status).toBe(302);
  const code = new URL(authorization.headers.get('location')!).searchParams.get('code')!;
  const response = await fetch(`${base}/common/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'calendar-client', client_secret: 'calendar-secret', grant_type: 'authorization_code', code, redirect_uri: redirect }),
  });
  expect(response.ok).toBe(true);
  token = (await response.json()).access_token;
});
afterAll(async () => { await host?.stop(); });

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
