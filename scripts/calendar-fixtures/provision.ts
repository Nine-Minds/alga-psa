/** Run from server/: npx tsx --tsconfig tsconfig.json ../scripts/calendar-fixtures/provision.ts --apply */
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

async function main() {
  assert(process.argv.includes('--apply'), 'Pass --apply to provision only the scoped calendar fixtures.');
  assert(process.cwd().endsWith('/server'), 'Run from the worktree server directory.');
  config({ path: '.env.local', override: true });
  process.env.NODE_ENV = 'development';
  assert.equal(process.env.DB_HOST, '127.0.0.1');
  assert.equal(process.env.DB_PORT, '6472');
  assert.equal(process.env.DB_NAME_SERVER, 'server');
  const { startEmulators, endpoints, fixtureDirectory, googleCredentials } = await import('./emulators.mjs');
  const overrides = {
    GOOGLE_CALENDAR_API_ROOT_URL: `${endpoints.google}/`, GOOGLE_OAUTH_TOKEN_URL: `${endpoints.google}/token`,
    MICROSOFT_GRAPH_BASE_URL: `${endpoints.graph}/v1.0/`, MICROSOFT_LOGIN_BASE_URL: `${endpoints.graph}/`,
  };
  if (process.argv.includes('--serve')) {
    for (const [key, value] of Object.entries(overrides)) {
      assert.equal(process.env[key], value, `Configure the app endpoint ${key} in server/.env.local before activating fixtures.`);
    }
  }
  Object.assign(process.env, overrides);
  const stop = await startEmulators();
  const { getAdminConnection } = await import('@alga-psa/db/admin');
  const { runWithTenant } = await import('@alga-psa/db');
  const { CalendarProviderService } = await import('../../ee/packages/calendar/src/lib/services/calendar/CalendarProviderService');
  const { GoogleCalendarAdapter } = await import('../../ee/packages/calendar/src/lib/services/calendar/providers/GoogleCalendarAdapter');
  const { MicrosoftCalendarAdapter } = await import('../../ee/packages/calendar/src/lib/services/calendar/providers/MicrosoftCalendarAdapter');
  const db = await getAdminConnection();
  const manifestFile = resolve(fixtureDirectory, 'providers.json');
  const manifest: Record<string, string> = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
  assert(Object.keys(manifest).every(key => key === 'google' || key === 'microsoft'), 'Unexpected manifest entries; refusing writes.');
  const activated = new Set<string>();
  const saveManifest = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const tenant = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
  const userId = '6684ee32-8f0a-46fb-b84c-4563337b2766';
  const service = new CalendarProviderService();
  try {
    assert(await db('users').where({ tenant, user_id: userId, email: 'glinda@emeraldcity.oz', user_type: 'internal' }).first(), 'Expected Glinda account absent; no fixture writes performed.');
    if (!manifest.google) {
      const placeholderId = '15b2d092-9fbc-4883-9ed7-0cda79350f52';
      const placeholder = await service.getProvider(placeholderId, tenant, { includeSecrets: true });
      assert(placeholder?.user_id === userId && placeholder.provider_type === 'google' && !placeholder.active && !placeholder.provider_config?.accessToken, 'Expected inactive token-free placeholder is absent; reconcile before continuing.');
      assert.equal((await db('calendar_event_mappings').where({ tenant, calendar_provider_id: placeholderId })).length, 0);
      manifest.google = placeholderId; saveManifest();
    }
    if (process.argv.includes('--verify-login')) {
      const { provisionDevelopmentLogin } = await import('../../server/src/lib/devLoginProvisioning');
      const { authenticateUser } = await import('../../packages/auth/src/actions/auth');
      const credentials = await provisionDevelopmentLogin();
      assert(credentials);
      const authenticated = await authenticateUser(credentials.email, credentials.password, 'internal', { tenantId: tenant, requireTenantMatch: true });
      assert.equal(authenticated?.user_id, userId);
      console.log('Application authenticateUser accepted the provisioned credential against the wired database (not browser sign-in).');
    }
    const preserved = await db('calendar_providers').where({ tenant }).whereNotIn('id', Object.values(manifest));
    const mappings = await db('calendar_event_mappings').where({ tenant });
    await runWithTenant(tenant, async () => {
      async function post(path: string, body: object) {
        const response = await fetch(`${endpoints.control}/control/msgraph/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        assert(response.ok, `Graph control failed: ${path}`); const result = await response.json(); assert(result.ok); return result.result;
      }
      await post('seed/client', { clientId: 'scoped-calendar-client', clientSecret: 'scoped-calendar-secret' });
      // Avoid changing the tenant's Microsoft profile binding just to refresh test tokens.
      await post('actions/configure', { accessTokenTtlSeconds: 604800 });
      const auth = new URL(`${endpoints.graph}/common/oauth2/v2.0/authorize`);
      auth.search = new URLSearchParams({ client_id: 'scoped-calendar-client', response_type: 'code', redirect_uri: 'http://127.0.0.1/fixture-callback', scope: 'offline_access User.Read Calendars.ReadWrite MailboxSettings.ReadWrite', state: 'scoped-fixture' }).toString();
      const authorization = await fetch(auth, { redirect: 'manual' });
      assert.equal(authorization.status, 302);
      const code = new URL(authorization.headers.get('location')!).searchParams.get('code')!;
      const exchange = await fetch(`${endpoints.graph}/common/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: 'scoped-calendar-client', client_secret: 'scoped-calendar-secret', grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1/fixture-callback' }) });
      assert(exchange.ok); const token = await exchange.json();
      for (const providerType of ['google', 'microsoft'] as const) {
        const providerName = `Shared calendar acceptance fixture (${providerType})`;
        const vendorConfig = providerType === 'google' ? { ...googleCredentials, calendarId: 'primary', tokenExpiresAt: new Date(0).toISOString(), redirectUri: 'http://127.0.0.1/fixture-callback' } : {
          clientId: 'scoped-calendar-client', clientSecret: 'scoped-calendar-secret', tenantId: 'common', calendarId: 'calendar',
          accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(), redirectUri: 'http://127.0.0.1/fixture-callback',
        };
        if (manifest[providerType]) {
          const existing = await service.getProvider(manifest[providerType], tenant);
          assert(existing?.user_id === userId && (existing.name === providerName || (providerType === 'google' && existing.id === '15b2d092-9fbc-4883-9ed7-0cda79350f52')) && existing.provider_type === providerType, 'Fixture ownership mismatch; refusing update.');
          await service.updateProvider(existing.id, tenant, { vendorConfig, isActive: false, providerName });
        } else {
          assert.equal((await service.getProviders({ tenant, userId, providerType })).filter(p => p.name === providerName).length, 0, 'Unjournaled fixture exists; reconcile before continuing.');
          const created = await service.createProvider({ tenant, userId, providerType, providerName, calendarId: providerType === 'google' ? 'primary' : 'calendar', isActive: false, syncDirection: 'bidirectional', vendorConfig });
          manifest[providerType] = created.id; saveManifest();
        }
        const table = `${providerType}_calendar_provider_config`;
        const stored = await db(table).where({ tenant, calendar_provider_id: manifest[providerType] }).first();
        assert(['client_secret', 'access_token', 'refresh_token'].every(key => stored?.[key]?.startsWith('enc:')), 'Fixture secrets must be encrypted at rest.');
        const loaded = await service.getProvider(manifest[providerType], tenant, { includeSecrets: true });
        assert(loaded?.provider_config?.accessToken && loaded.provider_config.refreshToken);
        const adapter = providerType === 'google' ? new GoogleCalendarAdapter(loaded) : new MicrosoftCalendarAdapter(loaded);
        await adapter.connect();
        assert.equal((await adapter.testConnection()).success, true);
        const created = await adapter.createEvent({ provider: providerType, title: 'Scoped adapter verification', description: 'Fixture delivery probe\n[Alga calendar: Fixture group]', ...(providerType === 'microsoft' ? { categories: ['Alga calendar: Fixture group'] } : {}), start: { dateTime: '2026-09-30T10:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-09-30T11:00:00Z', timeZone: 'UTC' } });
        try {
          const reloaded = await adapter.getEvent(created.id!);
          assert.equal(reloaded.title, 'Scoped adapter verification');
          assert(reloaded.description?.includes('[Alga calendar: Fixture group]'));
          if (providerType === 'microsoft') assert.deepEqual(reloaded.categories, ['Alga calendar: Fixture group']);
          await adapter.updateEvent(created.id!, { title: 'Verified persisted fixture' });
          assert.equal((await adapter.getEvent(created.id!)).title, 'Verified persisted fixture');
        } finally { await adapter.deleteEvent(created.id!); }
        await service.updateProviderStatus(loaded.id, { status: 'connected', errorMessage: null });
        console.log(`${providerType}: database-loaded credentials verified through create/read/update/delete (${loaded.id})`);
      }
    });
    const after = await db('calendar_providers').where({ tenant }).whereIn('id', preserved.map(p => p.id));
    assert.deepEqual(after.sort((a, b) => a.id.localeCompare(b.id)), preserved.sort((a, b) => a.id.localeCompare(b.id)));
    const afterMappings = await db('calendar_event_mappings').where({ tenant });
    assert.deepEqual(afterMappings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), mappings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    console.log('Existing providers and all mappings unchanged. Prepared fixtures remain inactive until the app uses emulator endpoints.');
    writeFileSync(resolve(fixtureDirectory, 'app.env'), Object.entries(overrides).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    if (process.argv.includes('--serve')) {
      await runWithTenant(tenant, async () => {
        for (const id of Object.values(manifest)) {
          await service.updateProvider(id, tenant, { isActive: true });
          activated.add(id);
        }
      });
      await new Promise<void>(resolveStop => {
        process.once('SIGINT', () => resolveStop());
        process.once('SIGTERM', () => resolveStop());
        console.log('Scoped fixtures active; emulators running. SIGINT/SIGTERM disables only these fixtures and saves emulator state.');
      });
    }
  } finally {
    try {
      if (process.argv.includes('--serve')) await runWithTenant(tenant, async () => {
        for (const id of activated) {
          await service.updateProvider(id, tenant, { isActive: false });
          assert.equal((await service.getProvider(id, tenant))?.active, false);
        }
      });
    } finally { await stop(); await db.destroy(); }
  }
}
main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : 'Fixture setup failed'); process.exit(1); });
