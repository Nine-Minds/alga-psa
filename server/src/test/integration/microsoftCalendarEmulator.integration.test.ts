import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '@alga-psa/emulator-msgraph';
import type { CalendarProviderConfig, ExternalCalendarEvent } from '@alga-psa/types';
import { MicrosoftCalendarAdapter as SharedAdapter } from '@alga-psa/integrations/services/calendar/providers/MicrosoftCalendarAdapter';
import { MicrosoftCalendarAdapter as EnterpriseAdapter } from '@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter';
import { generateMicrosoftCalendarAuthUrl as sharedAuthUrl } from '@alga-psa/integrations/utils/calendar/oauthHelpers';
import { generateMicrosoftCalendarAuthUrl as enterpriseAuthUrl } from '@alga-psa/ee-calendar/lib/utils/calendar/oauthHelpers';

const { persistTokens } = vi.hoisted(() => ({ persistTokens: vi.fn(async () => undefined) }));
// Provider persistence and the EE stored-profile lookup are fixture boundaries.
// HTTP, OAuth token exchange/refresh, event projection and vendor state execute normally.
vi.mock('@alga-psa/integrations/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class { updateProvider = persistTokens; },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class { updateProvider = persistTokens; },
}));
vi.mock('@alga-psa/ee-calendar/lib/microsoftConsumerProfileResolution', () => ({
  resolveMicrosoftConsumerProfileConfig: vi.fn(async () => ({
    status: 'ready', tenantId: 'calendar-tenant', consumerType: 'calendar',
    clientId: 'calendar-client', clientSecret: 'synthetic-calendar-secret',
    microsoftTenantId: 'common',
  })),
}));

let host: EmulatorHost;
let base: string;
let control: string;
async function controlPost(path: string, body = {}) {
  const response = await fetch(`${control}/control/msgraph/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result;
}
async function events() {
  const response = await fetch(`${control}/control/msgraph/state/calendar-events`);
  expect(response.ok).toBe(true);
  return (await response.json()).result;
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', `${base}/`);
  vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${base}/v1.0/`);
});
beforeEach(async () => { await controlPost('reset'); persistTokens.mockClear(); });
afterAll(async () => { vi.unstubAllEnvs(); await host?.stop(); });

const example: ExternalCalendarEvent = {
  id: '', provider: 'microsoft', title: 'Customer visit', description: '<p>Review backup restoration</p>',
  start: { dateTime: '2026-09-20T10:00:00Z', timeZone: 'UTC' },
  end: { dateTime: '2026-09-20T11:00:00Z', timeZone: 'UTC' },
  location: 'Conference room', visibility: 'private',
  attendees: [{ email: 'customer@example.test', name: 'Customer', responseStatus: 'accepted' }],
};

for (const { name, Adapter, authUrl } of [
  { name: 'shared', Adapter: SharedAdapter, authUrl: sharedAuthUrl },
  { name: 'enterprise', Adapter: EnterpriseAdapter, authUrl: enterpriseAuthUrl },
]) {
  describe(`${name} Microsoft calendar adapter over Graph wire`, () => {
    async function connected(expired = false) {
      const clientId = 'calendar-client', clientSecret = 'synthetic-calendar-secret';
      await controlPost('seed/client', { clientId, clientSecret });
      const redirectUri = 'http://localhost/calendar-callback';
      const url = await authUrl({ clientId, redirectUri, state: 'calendar-state', tenantId: 'common' });
      expect(new URL(url).origin).toBe(base);
      const authorization = await fetch(url, { redirect: 'manual' });
      expect(authorization.status).toBe(302);
      const callback = new URL(authorization.headers.get('location')!);
      expect(callback.searchParams.get('state')).toBe('calendar-state');
      const tokenResponse = await fetch(`${base}/common/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: callback.searchParams.get('code')!, redirect_uri: redirectUri }) });
      expect(tokenResponse.ok).toBe(true);
      const token = await tokenResponse.json();
      const config: CalendarProviderConfig = {
        id: 'calendar-provider', tenant: 'calendar-tenant', user_id: 'calendar-user', name: 'Calendar',
        provider_type: 'microsoft', calendar_id: 'calendar', active: true, sync_direction: 'bidirectional',
        connection_status: 'connected', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        provider_config: { clientId, clientSecret, accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiresAt: new Date(expired ? 0 : Date.now() + 3600000).toISOString() },
      };
      const adapter = new Adapter(config);
      await adapter.connect();
      return { adapter, oldToken: token.access_token, config };
    }

    it('creates, reloads, lists, updates and deletes the primary-calendar event', async () => {
      const { adapter } = await connected();
      expect(await adapter.testConnection()).toEqual({ success: true });
      expect(await adapter.listCalendars()).toEqual([{ id: 'calendar', name: 'Calendar', primary: true }]);
      const created = await adapter.createEvent(example);
      expect(created.id).toBeTruthy();
      expect(await adapter.getEvent(created.id)).toMatchObject({ ...example, id: created.id });
      expect(await events()).toEqual([expect.objectContaining({ id: created.id, subject: example.title, location: { displayName: example.location }, sensitivity: 'private' })]);
      expect(await adapter.listEvents(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-21T00:00:00Z'))).toHaveLength(1);
      expect(await adapter.listEvents(new Date('2026-09-22T00:00:00Z'), new Date('2026-09-23T00:00:00Z'))).toEqual([]);
      await adapter.updateEvent(created.id, { title: 'Rescheduled visit', location: 'Remote', visibility: 'default', start: { dateTime: '2026-09-20T12:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-09-20T13:00:00Z', timeZone: 'UTC' } });
      expect(await adapter.getEvent(created.id)).toMatchObject({ title: 'Rescheduled visit', location: 'Remote', visibility: 'default', start: { dateTime: '2026-09-20T12:00:00Z' } });
      await adapter.deleteEvent(created.id);
      expect(await events()).toEqual([]);
      await expect(adapter.getEvent(created.id)).rejects.toMatchObject({ status: 404, code: 'ErrorItemNotFound' });
    });

    it('refreshes expired credentials through the configured login endpoint', async () => {
      const { adapter, oldToken, config } = await connected(true);
      expect(config.provider_config!.accessToken).not.toBe(oldToken);
      expect(persistTokens).toHaveBeenCalledWith('calendar-provider', 'calendar-tenant', expect.objectContaining({ vendorConfig: expect.objectContaining({ accessToken: config.provider_config!.accessToken }) }));
      const created = await adapter.createEvent(example);
      expect((await adapter.getEvent(created.id)).title).toBe(example.title);
    });

    it.each([403, 429, 503])('surfaces HTTP %s without creating an event, then permits a deliberate retry', async status => {
      const { adapter } = await connected();
      await controlPost('faults/operation-fault/arm', { operation: 'POST /me/calendar/events', status, body: { error: { code: `Model${status}`, message: 'Injected provider failure' } }, remaining: 1 });
      await expect(adapter.createEvent(example)).rejects.toMatchObject({ status, code: `Model${status}` });
      expect(await events()).toEqual([]);
      const created = await adapter.createEvent(example);
      expect(await events()).toEqual([expect.objectContaining({ id: created.id })]);
    });
  });
}
