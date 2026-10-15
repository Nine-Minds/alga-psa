import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import qbo from '../src/index';

// Only unrelated session/nonce infrastructure and logging are isolated. Axios,
// the real cleanup consumer, and the emulator's HTTP/token state all run.
const isolated = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: isolated }));
vi.mock('@alga-psa/auth', () => ({
  getCurrentUserWithRevocationCheck: vi.fn(() => { throw new Error('Unexpected session lookup'); }),
  hasPermission: vi.fn(() => { throw new Error('Unexpected permission lookup'); }),
}));
vi.mock('../../../integrations/src/lib/accountingOAuthStateStore', () => ({
  consumeAccountingOAuthNonce: vi.fn(() => { throw new Error('Unexpected nonce lookup'); }),
}));

let host: EmulatorHost;
let vendor: string;
let control: string;
let blockedDestinations: string[];
let removeGuard = () => {};
let cleanup: typeof import('../../../integrations/src/lib/accountingConnectionAuth').revokeAccountingOAuthGrant;
const previousRevokeUrl = process.env.QBO_OAUTH_REVOKE_URL;
const authorization = `Basic ${Buffer.from('cleanup-app:fixture-secret').toString('base64')}`;

beforeEach(async () => {
  vi.clearAllMocks();
  host = new EmulatorHost({ emulators: [qbo], controlPort: 0, ports: { qbo: 0 } });
  const { controlPort, ports } = await host.start();
  vendor = `http://127.0.0.1:${ports.qbo}`;
  control = `http://127.0.0.1:${controlPort}`;
  for (const clientId of ['cleanup-app', 'foreign-app']) {
    const response = await fetch(`http://127.0.0.1:${controlPort}/control/qbo/seed/client`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret: 'fixture-secret' }),
    });
    expect((await response.json()).ok).toBe(true);
  }
  // The consumer captures this URL at module evaluation, not at request time.
  process.env.QBO_OAUTH_REVOKE_URL = `${vendor}/v2/oauth2/tokens/revoke`;
  vi.resetModules();
  const axios = (await import('axios')).default;
  blockedDestinations = [];
  const guard = axios.interceptors.request.use(config => {
    if (new URL(config.url!, config.baseURL).origin !== vendor) {
      blockedDestinations.push(config.url!);
      throw new Error('Blocked non-emulator accounting request');
    }
    return config;
  });
  removeGuard = () => axios.interceptors.request.eject(guard);
  ({ revokeAccountingOAuthGrant: cleanup } = await import('../../../integrations/src/lib/accountingConnectionAuth'));
});
afterEach(async () => {
  removeGuard();
  removeGuard = () => {};
  if (previousRevokeUrl === undefined) delete process.env.QBO_OAUTH_REVOKE_URL;
  else process.env.QBO_OAUTH_REVOKE_URL = previousRevokeUrl;
  vi.resetModules();
  await host?.stop();
});

const tokenRequest = (params: Record<string, string>) => fetch(`${vendor}/oauth2/v1/tokens/bearer`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
  body: new URLSearchParams(params),
});
const company = (accessToken: string) => fetch(`${vendor}/v3/company/realm-sim/companyinfo/realm-sim`, {
  headers: { authorization: `Bearer ${accessToken}` },
});
async function authorize() {
  const redirectUri = 'http://localhost/cleanup-callback';
  const response = await fetch(`${vendor}/connect/oauth2?${new URLSearchParams({ client_id: 'cleanup-app', redirect_uri: redirectUri })}`, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
  const exchanged = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  expect(exchanged.status).toBe(200);
  return exchanged.json();
}

async function expectCleanupRequest(status: number) {
  expect(blockedDestinations).toEqual([]);
  const response = await fetch(`${control}/control/qbo/requests`);
  expect(response.status).toBe(200);
  const journal = await response.json();
  expect(journal.result.complete).toBe(true);
  expect(journal.result.requests.filter((request: { path: string }) => request.path === '/v2/oauth2/tokens/revoke'))
    .toEqual([expect.objectContaining({ method: 'POST', path: '/v2/oauth2/tokens/revoke', status })]);
}

it('real accounting callback cleanup invalidates its obtained grant at the provider', async () => {
  const tokens = await authorize();
  expect((await company(tokens.access_token)).status).toBe(200);
  await cleanup({ provider: 'qbo', clientId: 'cleanup-app', clientSecret: 'fixture-secret', refreshToken: tokens.refresh_token });
  await expectCleanupRequest(200);
  expect(isolated.warn).not.toHaveBeenCalled();
  expect((await company(tokens.access_token)).status).toBe(401);
  const rejected = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: 'invalid_grant' });
});

it.each([
  { clientId: 'cleanup-app', clientSecret: 'incorrect-secret', status: 401 },
  { clientId: 'foreign-app', clientSecret: 'fixture-secret', status: 400 },
])('failed cleanup for $clientId remains best effort and cannot invalidate the grant', async ({ status, ...credentials }) => {
  const tokens = await authorize();
  await expect(cleanup({ provider: 'qbo', ...credentials, refreshToken: tokens.refresh_token })).resolves.toBeUndefined();
  await expectCleanupRequest(status);
  expect(isolated.warn).toHaveBeenCalledOnce();
  expect(isolated.info).not.toHaveBeenCalled();
  expect((await company(tokens.access_token)).status).toBe(200);
  expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status).toBe(200);
});
