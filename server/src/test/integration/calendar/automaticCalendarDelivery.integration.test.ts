import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '@alga-psa/emulator-msgraph';
import type { Knex } from 'knex';
import type { CalendarProviderConfig } from '@alga-psa/types';
import { createTestDbConnection, dropCalendarDeliveryTestDatabase } from '../../../../test-utils/dbConfig';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';

const fixture = vi.hoisted(() => ({
  db: null as Knex | null,
  tenant: '',
  providers: [] as CalendarProviderConfig[],
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: fixture.db, tenant: fixture.tenant }),
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProviders() { return fixture.providers; }
    async getProvider(id: string) { return fixture.providers.find(provider => provider.id === id) ?? null; }
    async updateProvider() { return undefined; }
    async updateProviderStatus() { return undefined; }
  },
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info() {}, warn() {}, debug() {}, error() {} } }));

import { getEventBus } from '@alga-psa/event-bus';
import { CalendarSyncService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from '@alga-psa/ee-calendar/lib/eventBus/subscribers/calendarSyncSubscriber';
import { generateMicrosoftCalendarAuthUrl } from '@alga-psa/ee-calendar/lib/utils/calendar/oauthHelpers';

let db: Knex;
let dbName: string;
let googleServer: Server;
let graphHost: EmulatorHost;
let graphBase: string;
let graphControl: string;
const googleEvents = new Map<string, any>();
const tenant = randomUUID();
const userId = randomUUID();
const calendarId = randomUUID();
const channel = `calendar-delivery-${randomUUID()}`;
const routePrefix = `calendar-delivery-test:${randomUUID()}:`;
const entryTitle = 'Quarterly maintenance window';
const calendarName = 'Operations rotation';

async function postControl(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${graphControl}/control/msgraph/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result;
}

beforeAll(async () => {
  // This uniquely named database is created by the test helper and dropped in afterAll.
  dbName = `calendar_delivery_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db = await createTestDbConnection({ databaseName: dbName, runSeeds: false, migrationsDir: new URL('../../../../migrations', import.meta.url).pathname });
  fixture.db = db;
  fixture.tenant = tenant;

  const google = express();
  google.use(express.json());
  google.use(express.urlencoded({ extended: false }));
  google.post('/token', (req, res) => {
    if (req.body.grant_type !== 'refresh_token' || req.body.refresh_token !== 'local-calendar-refresh') return res.status(400).json({ error: 'invalid_grant' });
    res.json({ access_token: 'local-calendar-access', refresh_token: 'local-calendar-refresh', expires_in: 3600, token_type: 'Bearer' });
  });
  google.use('/calendar', (req, res, next) => req.header('authorization') === 'Bearer local-calendar-access' ? next() : res.status(401).end());
  google.all(['/calendar/v3/calendars/:calendarId/events', '/calendar/v3/calendars/:calendarId/events/:eventId'], (req, res) => {
    if (req.method === 'POST') {
      const event = { ...req.body, id: randomUUID(), calendarId: req.params.calendarId, status: 'confirmed', updated: new Date().toISOString() };
      googleEvents.set(event.id, event); return res.json(event);
    }
    const event = googleEvents.get(String(req.params.eventId));
    if (!event) return res.status(404).json({ error: { message: 'Not found' } });
    return res.json(event);
  });
  googleServer = await new Promise<Server>(resolve => {
    const server = google.listen(0, '127.0.0.1', () => resolve(server));
  });
  const googlePort = (googleServer.address() as any).port;
  vi.stubEnv('GOOGLE_CALENDAR_API_ROOT_URL', `http://127.0.0.1:${googlePort}/`);
  vi.stubEnv('GOOGLE_OAUTH_TOKEN_URL', `http://127.0.0.1:${googlePort}/token`);

  graphHost = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const graph = await graphHost.start();
  graphBase = `http://127.0.0.1:${graph.ports.msgraph}`;
  graphControl = `http://127.0.0.1:${graph.controlPort}`;
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', `${graphBase}/`);
  vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${graphBase}/v1.0/`);
  await postControl('seed/client', { clientId: 'delivery-client', clientSecret: 'delivery-secret' });
  const authUrl = await generateMicrosoftCalendarAuthUrl({ clientId: 'delivery-client', redirectUri: 'http://localhost/calendar-callback', state: 'delivery-state', tenantId: 'common' });
  const auth = await fetch(authUrl, { redirect: 'manual' });
  const callback = new URL(auth.headers.get('location')!);
  const tokenResponse = await fetch(`${graphBase}/common/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'delivery-client', client_secret: 'delivery-secret', grant_type: 'authorization_code', code: callback.searchParams.get('code')!, redirect_uri: 'http://localhost/calendar-callback' }) });
  expect(tokenResponse.ok).toBe(true);
  const graphTokens = await tokenResponse.json();

  await db('tenants').insert({ tenant, client_name: 'Automatic calendar delivery fixture', email: `${tenant}@example.test`, created_at: new Date(), updated_at: new Date() });
  await db('users').insert({ tenant, user_id: userId, username: `delivery-${userId.slice(0, 8)}`, email: `${userId}@example.test`, user_type: 'internal', hashed_password: 'unused', created_at: new Date(), updated_at: new Date() });
  await db('calendars').insert({ tenant, calendar_id: calendarId, calendar_type: 'group', name: calendarName, is_archived: false, created_at: new Date(), updated_at: new Date() });
  const entry = await ScheduleEntry.create(db, tenant, {
    title: entryTitle, notes: 'Bring the replacement router.', scheduled_start: new Date('2026-10-02T14:00:00Z'), scheduled_end: new Date('2026-10-02T15:00:00Z'),
    status: 'scheduled', work_item_type: 'ad_hoc', calendar_id: calendarId,
  } as any, { assignedUserIds: [userId] });
  (globalThis as any).__calendarDeliveryEntryId = entry.entry_id;
  fixture.providers = [
    {
      id: randomUUID(), tenant, user_id: userId, provider_type: 'google', provider_name: 'Fixture Google', calendar_id: 'primary',
      is_active: true, active: true, sync_direction: 'bidirectional', status: 'connected', connection_status: 'connected', name: 'Fixture Google',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      provider_config: { clientId: 'shared-calendar-fixture', clientSecret: 'local-calendar-fixture-secret', accessToken: 'local-calendar-access', refreshToken: 'local-calendar-refresh', tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), apiRoot: `http://127.0.0.1:${googlePort}/`, tokenEndpoint: `http://127.0.0.1:${googlePort}/token` },
    } as any,
    {
      id: randomUUID(), tenant, user_id: userId, provider_type: 'microsoft', provider_name: 'Fixture Outlook', calendar_id: 'calendar',
      is_active: true, active: true, sync_direction: 'bidirectional', status: 'connected', connection_status: 'connected', name: 'Fixture Outlook',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      provider_config: { clientId: 'delivery-client', clientSecret: 'delivery-secret', accessToken: graphTokens.access_token, refreshToken: graphTokens.refresh_token, tokenExpiresAt: new Date(Date.now() + Number(graphTokens.expires_in) * 1000).toISOString() },
    } as any,
  ];
});

afterAll(async () => {
  await unregisterCalendarSyncSubscriber();
  await getEventBus().close();
  vi.unstubAllEnvs();
  if (googleServer) await new Promise<void>(resolve => googleServer.close(() => resolve()));
  await graphHost?.stop();
  await db?.destroy();
  if (dbName) await dropCalendarDeliveryTestDatabase(dbName);
});

it('delivers an EventBus schedule event through the real subscriber and sync service to both providers', async () => {
  vi.stubEnv('REDIS_PREFIX', routePrefix);
  vi.stubEnv('REDIS_STREAM_BLOCKING_TIMEOUT', '100');
  const bus = getEventBus();
  await registerCalendarSyncSubscriber(channel);
  const entryId = (globalThis as any).__calendarDeliveryEntryId as string;
  await bus.publish({ eventType: 'SCHEDULE_ENTRY_CREATED', payload: { tenantId: tenant, userId, entryId, changes: { assignedUserIds: [userId] } } } as any, { channel, strict: true });

  await expect.poll(async () => db('calendar_event_mappings').where({ tenant, schedule_entry_id: entryId }).count('* as count').first().then(row => Number(row?.count)), { timeout: 15000 }).toBe(2);
  const mappings = await db('calendar_event_mappings').where({ tenant, schedule_entry_id: entryId });
  expect(mappings).toHaveLength(2);
  const googleEvent = [...googleEvents.values()][0];
  expect(googleEvent).toMatchObject({ summary: entryTitle, description: expect.stringContaining(`[Alga calendar: ${calendarName}]`) });
  expect(googleEvent.description).toContain('Bring the replacement router.');
  const graphResponse = await fetch(`${graphControl}/control/msgraph/state/calendar-events`);
  expect(graphResponse.ok).toBe(true);
  const graphEvents = (await graphResponse.json()).result;
  expect(graphEvents).toHaveLength(1);
  expect(graphEvents[0]).toMatchObject({ subject: entryTitle, categories: [`Alga calendar: ${calendarName}`] });
  expect(graphEvents[0].body.content).toContain(`[Alga calendar: ${calendarName}]`);
  expect(graphEvents[0].body.content).toContain('Bring the replacement router.');
  expect(new Set(mappings.map(row => row.calendar_provider_id))).toEqual(new Set(fixture.providers.map(provider => provider.id)));
});
