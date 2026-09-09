import { expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import xero from '../src/index';

// Real XeroClientService + Axios + vendor HTTP. Credential storage is private
// memory; disconnect serialization/DB infrastructure is outside this contract.
const state = vi.hoisted(() => ({ secrets: new Map<string, string>(), writes: 0 }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => ({
  getAppSecret: async () => undefined,
  getTenantSecret: async (tenant: string, name: string) => state.secrets.get(`${tenant}:${name}`),
  setTenantSecret: async (tenant: string, name: string, value: string) => { state.writes++; state.secrets.set(`${tenant}:${name}`, value); },
}) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {}, tenant: 'recovery-tenant' }) }));
vi.mock('../../../integrations/src/lib/providerDisconnect/lock', () => ({
  withProviderCredentialLock: async (_db: unknown, _tenant: string, _provider: string, fn: (db: unknown) => unknown) => fn({}),
  getProviderCredentialWriteDisposition: async () => 'allowed',
}));
vi.mock('../../../integrations/src/lib/providerDisconnect/retire', () => ({ retireTerminalDisconnectRecord: async () => undefined }));

it('refreshes the selected organisation once without overwriting a newer sibling connection', async () => {
  state.secrets.clear(); state.writes = 0;
  const tenant = 'recovery-tenant';
  const host = new EmulatorHost({ emulators: [xero], controlPort: 0, ports: { xero: 0 } });
  const previous = { XERO_OAUTH_TOKEN_URL: process.env.XERO_OAUTH_TOKEN_URL, XERO_API_BASE_URL: process.env.XERO_API_BASE_URL };
  let removeGuard = () => {};
  try {
    const running = await host.start();
    const vendor = `http://127.0.0.1:${running.ports.xero}`;
    const control = `http://127.0.0.1:${running.controlPort}`;
    const command = async (path: string, body: unknown = {}) => {
      const response = await fetch(`${control}/control/xero/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.status).toBe(200);
      expect((await response.json()).ok).toBe(true);
    };
    const journal = async () => {
      const response = await fetch(`${control}/control/xero/requests`);
      const data = await response.json();
      expect(data.result.complete).toBe(true);
      return data.result.requests.map((r: any) => ({ method: r.method, path: r.path, status: r.status }));
    };
    const redirectUri = 'http://localhost/xero-recovery';
    await command('seed/application', { type: 'confidential', clientId: 'recovery-app', clientSecret: 'fixture-secret', redirectUris: [redirectUri] });
    for (const org of ['sibling-org', 'selected-org']) {
      await command('seed/organisation', { tenantId: org, tenantName: org });
      await command('seed/contact', { name: 'Recovery contact', emailAddress: `${org}@example.test`, xeroTenantId: org });
    }
    await command('actions/set-connections', { clientId: 'recovery-app', xeroTenantIds: ['sibling-org', 'selected-org'] });
    const authorize = await fetch(`${vendor}/identity/connect/authorize?${new URLSearchParams({ client_id: 'recovery-app', redirect_uri: redirectUri, response_type: 'code', scope: 'offline_access accounting.contacts', state: 'fixture' })}`, { redirect: 'manual' });
    expect(authorize.status).toBe(302);
    const exchange = await fetch(`${vendor}/connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(authorize.headers.get('location')!).searchParams.get('code')!, redirect_uri: redirectUri, client_id: 'recovery-app', client_secret: 'fixture-secret' }) });
    expect(exchange.status).toBe(200);
    const tokens = await exchange.json();
    const credentials = (connectionId: string, xeroTenantId: string) => ({ connectionId, xeroTenantId,
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString() });
    const selected = credentials('selected-connection', 'selected-org');
    const sibling = credentials('sibling-connection', 'sibling-org');
    const store = (value: unknown) => state.secrets.set(`${tenant}:xero_credentials`, JSON.stringify(value));
    const stored = () => JSON.parse(state.secrets.get(`${tenant}:xero_credentials`)!);
    store({ 'sibling-connection': sibling, 'selected-connection': selected });
    state.secrets.set(`${tenant}:xero_client_id`, 'recovery-app');
    state.secrets.set(`${tenant}:xero_client_secret`, 'fixture-secret');
    process.env.XERO_OAUTH_TOKEN_URL = `${vendor}/connect/token`;
    process.env.XERO_API_BASE_URL = `${vendor}/api.xro/2.0`;
    vi.resetModules();
    const axios = (await import('axios')).default;
    const blocked: string[] = [];
    const observedTenants: string[] = [];
    const guard = axios.interceptors.request.use(config => {
      const destination = new URL(config.url!, config.baseURL);
      if (destination.origin !== vendor) { blocked.push(destination.origin); throw new Error('Blocked external provider destination'); }
      if (destination.pathname.endsWith('/Contacts')) observedTenants.push(String(config.headers['Xero-tenant-id']));
      config.maxRedirects = 0;
      return config;
    });
    removeGuard = () => axios.interceptors.request.eject(guard);
    const { XeroClientService } = await import('../../../integrations/src/lib/xero/xeroClientService');
    // Select by organisation ID, deliberately not the default first connection.
    const service = await XeroClientService.create(tenant, 'selected-org');
    // A concurrent writer updates another connection after this instance read it.
    // These sentinel credentials are never sent to the provider.
    const newerSibling = { ...sibling, accessToken: 'newer-sibling-access', refreshToken: 'newer-sibling-refresh', scope: 'newer-sibling-scope' };
    store({ 'sibling-connection': newerSibling, 'selected-connection': selected });
    await command('actions/expire-access-tokens');
    const offset = (await journal()).length;
    expect(await service.findContactByName('Recovery contact')).toMatchObject({ raw: { EmailAddress: 'selected-org@example.test' } });
    expect(blocked).toEqual([]);
    expect(observedTenants).toEqual(['selected-org', 'selected-org']);
    expect((await journal()).slice(offset)).toEqual([
      { method: 'GET', path: '/api.xro/2.0/Contacts', status: 401 },
      { method: 'POST', path: '/connect/token', status: 200 },
      { method: 'GET', path: '/api.xro/2.0/Contacts', status: 200 },
    ]);
    expect(state.writes).toBe(1);
    expect(stored()['sibling-connection']).toEqual(newerSibling);
    expect(stored()['selected-connection']).toMatchObject({ connectionId: selected.connectionId, xeroTenantId: 'selected-org' });
    expect(stored()['selected-connection'].accessToken).not.toBe(selected.accessToken);
    expect(stored()['selected-connection'].refreshToken).not.toBe(selected.refreshToken);
  } finally {
    removeGuard();
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    vi.resetModules();
    await host.stop();
  }
});
