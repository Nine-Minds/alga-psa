import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import qbo from '../src/index';

// Real QboClientService + Axios + vendor HTTP. Credential storage is private
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
vi.mock('../../../integrations/src/lib/qbo/qboConnectionChangeProvider', () => ({ notifyQboConnectionChanged: async () => undefined }));

const tenant = 'recovery-tenant';
const realm = 'realm-sim';
let host: EmulatorHost;
let vendor: string;
let control: string;
let removeGuard = () => {};
let blocked: string[];
let service: Awaited<ReturnType<typeof import('../../../integrations/src/lib/qbo/qboClientService').QboClientService.create>>;
const savedEnv = { QBO_OAUTH_TOKEN_URL: process.env.QBO_OAUTH_TOKEN_URL, QBO_API_BASE_URL: process.env.QBO_API_BASE_URL };
const authorization = `Basic ${Buffer.from('recovery-app:fixture-secret').toString('base64')}`;
const stored = () => JSON.parse(state.secrets.get(`${tenant}:qbo_credentials`)!) as Record<string, any>;
async function command(path: string, body: unknown = {}) {
  const response = await fetch(`${control}/control/qbo/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
  expect((await response.json()).ok).toBe(true);
}
async function authorize() {
  const redirectUri = 'http://localhost/recovery-callback';
  const response = await fetch(`${vendor}/connect/oauth2?${new URLSearchParams({ client_id: 'recovery-app', redirect_uri: redirectUri })}`, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
  const exchange = await fetch(`${vendor}/oauth2/v1/tokens/bearer`, { method: 'POST', headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }) });
  expect(exchange.status).toBe(200);
  const tokens = await exchange.json();
  state.secrets.set(`${tenant}:qbo_credentials`, JSON.stringify({ [realm]: { realmId: realm, accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token, accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString() } }));
}
async function journal() {
  expect(blocked).toEqual([]);
  const result = await (await fetch(`${control}/control/qbo/requests`)).json();
  expect(result.result.complete).toBe(true);
  return result.result.requests.map((r: any) => ({ method: r.method, path: r.path, status: r.status }));
}
beforeEach(async () => {
  state.secrets.clear(); state.writes = 0;
  host = new EmulatorHost({ emulators: [qbo], controlPort: 0, ports: { qbo: 0 } });
  const running = await host.start();
  vendor = `http://127.0.0.1:${running.ports.qbo}`; control = `http://127.0.0.1:${running.controlPort}`;
  await command('seed/client', { clientId: 'recovery-app', clientSecret: 'fixture-secret' });
  await command('seed/customer', { name: 'Recovery Customer' });
  state.secrets.set(`${tenant}:qbo_client_id`, 'recovery-app');
  state.secrets.set(`${tenant}:qbo_client_secret`, 'fixture-secret');
  await authorize();
  process.env.QBO_OAUTH_TOKEN_URL = `${vendor}/oauth2/v1/tokens/bearer`;
  process.env.QBO_API_BASE_URL = `${vendor}/v3/company`;
  vi.resetModules();
  const axios = (await import('axios')).default;
  blocked = [];
  const id = axios.interceptors.request.use(config => {
    if (new URL(config.url!, config.baseURL).origin !== vendor) { blocked.push(config.url!); throw new Error('Blocked external provider destination'); }
    config.maxRedirects = 0;
    return config;
  });
  removeGuard = () => axios.interceptors.request.eject(id);
  const { QboClientService } = await import('../../../integrations/src/lib/qbo/qboClientService');
  service = await QboClientService.create(tenant, realm);
});
afterEach(async () => {
  removeGuard(); removeGuard = () => {};
  for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  vi.resetModules(); await host?.stop();
});

it('recovers a real API401 by refreshing, persisting credentials and retrying the original read once', async () => {
  const original = stored()[realm];
  const offset = (await journal()).length;
  await command('actions/expire-access-tokens');
  expect(await service.query('SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1 MAXRESULTS 100')).toEqual([expect.objectContaining({ DisplayName: 'Recovery Customer' })]);
  expect((await journal()).slice(offset)).toEqual([
    { method: 'GET', path: `/v3/company/${realm}/query`, status: 401 },
    { method: 'POST', path: '/oauth2/v1/tokens/bearer', status: 200 },
    { method: 'GET', path: `/v3/company/${realm}/query`, status: 200 },
  ]);
  expect(state.writes).toBe(1);
  const updated = stored()[realm];
  expect(updated.accessToken).not.toBe(original.accessToken);
  expect(updated.refreshToken).not.toBe(original.refreshToken);
  // A newly constructed consumer reads the persisted replacement and needs no
  // additional refresh. This checks persistence rather than only in-memory state.
  const { QboClientService } = await import('../../../integrations/src/lib/qbo/qboClientService');
  const fresh = await QboClientService.create(tenant, realm);
  expect(await fresh.query('SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1 MAXRESULTS 100')).toHaveLength(1);
  expect(state.writes).toBe(1);
  expect((await journal()).slice(offset)).toHaveLength(4);
});

it('stops on a revoked refresh grant without overwriting stored credentials or replaying the API read', async () => {
  const original = state.secrets.get(`${tenant}:qbo_credentials`);
  await command('actions/expire-access-tokens');
  await command('actions/revoke-refresh-token', { refreshToken: stored()[realm].refreshToken });
  const offset = (await journal()).length;
  await expect(service.query('SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1 MAXRESULTS 100')).rejects.toMatchObject({ response: { status: 400, data: { error: 'invalid_grant' } } });
  expect((await journal()).slice(offset)).toEqual([
    { method: 'GET', path: `/v3/company/${realm}/query`, status: 401 },
    { method: 'POST', path: '/oauth2/v1/tokens/bearer', status: 400 },
  ]);
  expect(state.secrets.get(`${tenant}:qbo_credentials`)).toBe(original);
  expect(state.writes).toBe(0);
});

it('stops after one refresh when the replacement access token also expires before the API retry', async () => {
  await command('actions/expire-access-tokens');
  const offset = (await journal()).length;
  const axios = (await import('axios')).default;
  // Synchronize the existing emulator expiry action with the real refresh
  // response; no HTTP response or service method is replaced by this hook.
  const interceptor = axios.interceptors.response.use(async response => {
    if (new URL(response.config.url!, response.config.baseURL).pathname === '/oauth2/v1/tokens/bearer') {
      await command('actions/expire-access-tokens');
    }
    return response;
  });
  try {
    await expect(service.query('SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1 MAXRESULTS 100'))
      .rejects.toMatchObject({ details: { provider: 'qbo', status: 401, qboOperation: 'query' } });
    expect((await journal()).slice(offset)).toEqual([
      { method: 'GET', path: `/v3/company/${realm}/query`, status: 401 },
      { method: 'POST', path: '/oauth2/v1/tokens/bearer', status: 200 },
      { method: 'GET', path: `/v3/company/${realm}/query`, status: 401 },
    ]);
    expect(state.writes).toBe(1);
  } finally {
    axios.interceptors.response.eject(interceptor);
  }
});

it.each([429, 503])('surfaces HTTP%s once without refreshing credentials and recovers on the next operation', async status => {
  const original = state.secrets.get(`${tenant}:qbo_credentials`);
  const offset = (await journal()).length;
  // An explicit transport outage: this synthetic body does not claim Intuit
  // wire parity, and recovery is a new operation rather than automatic backoff.
  await command('faults/transport:error/arm', { status });
  await expect(service.query('SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1 MAXRESULTS 100'))
    .rejects.toMatchObject({ details: { provider: 'qbo', status, qboOperation: 'query' } });
  expect((await journal()).slice(offset)).toEqual([
    { method: 'GET', path: `/v3/company/${realm}/query`, status },
  ]);
  expect(state.secrets.get(`${tenant}:qbo_credentials`)).toBe(original);
  expect(state.writes).toBe(0);
  await command('faults/transport:error/disarm');
  expect(await service.query('SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1 MAXRESULTS 100'))
    .toEqual([expect.objectContaining({ DisplayName: 'Recovery Customer' })]);
  expect((await journal()).slice(offset)).toEqual([
    { method: 'GET', path: `/v3/company/${realm}/query`, status },
    { method: 'GET', path: `/v3/company/${realm}/query`, status: 200 },
  ]);
  expect(state.secrets.get(`${tenant}:qbo_credentials`)).toBe(original);
  expect(state.writes).toBe(0);
});
