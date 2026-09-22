import { expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import xero from '../src/index';

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: logs }));
vi.mock('@alga-psa/auth', () => ({ getCurrentUserWithRevocationCheck: vi.fn(), hasPermission: vi.fn() }));
vi.mock('../../../integrations/src/lib/accountingOAuthStateStore', () => ({ consumeAccountingOAuthNonce: vi.fn() }));

it.each([false, true])('actual OAuth cleanup handles failed authentication=%s through Xero HTTP', async invalidSecret => {
  const previous = process.env.XERO_OAUTH_REVOKE_URL;
  const host = new EmulatorHost({ emulators: [xero], controlPort: 0, ports: { xero: 0 } });
  let started = false;
  let removeGuard = () => {};
  try {
    const running = await host.start();
    started = true;
    const vendor = `http://127.0.0.1:${running.ports.xero}`;
    const control = `http://127.0.0.1:${running.controlPort}`;
    const postControl = async (path: string, value: unknown) => {
      const response = await fetch(`${control}/control/xero/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).ok).toBe(true);
    };
    const redirectUri = 'http://localhost/cleanup-fixture';
    await postControl('seed/application', { type: 'confidential', clientId: 'cleanup-app', clientSecret: 'cleanup-secret', redirectUris: [redirectUri] });
    await postControl('seed/organisation', { tenantId: 'cleanup-org', tenantName: 'Cleanup fixture' });
    await postControl('actions/set-connections', { clientId: 'cleanup-app', xeroTenantIds: ['cleanup-org'] });
    const startAuthorization = () => fetch(`${vendor}/identity/connect/authorize?${new URLSearchParams({
      client_id: 'cleanup-app', redirect_uri: redirectUri, response_type: 'code', scope: 'offline_access accounting.contacts', state: 'fixture',
    })}`, { redirect: 'manual' });
    const authorize = await startAuthorization();
    expect(authorize.status).toBe(302);
    const tokenRequest = (params: Record<string, string>) => fetch(`${vendor}/connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('cleanup-app:cleanup-secret').toString('base64')}` },
      body: new URLSearchParams(params),
    });
    const exchanged = await tokenRequest({ grant_type: 'authorization_code', redirect_uri: redirectUri,
      code: new URL(authorize.headers.get('location')!).searchParams.get('code')! });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json();
    const connections = () => fetch(`${vendor}/connections`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(await (await connections()).json()).toEqual([expect.objectContaining({ tenantId: 'cleanup-org' })]);

    // This setting is read at module initialization. Restore it and the module
    // cache afterwards so no later consumer inherits this short-lived endpoint.
    process.env.XERO_OAUTH_REVOKE_URL = `${vendor}/connect/revocation`;
    vi.resetModules();
    logs.info.mockClear();
    logs.warn.mockClear();
    const axios = (await import('axios')).default;
    const blocked: string[] = [];
    const guard = axios.interceptors.request.use(config => {
      if (new URL(config.url!, config.baseURL).origin !== vendor) {
        blocked.push(config.url!);
        throw new Error('Blocked non-emulator accounting request');
      }
      return config;
    });
    removeGuard = () => axios.interceptors.request.eject(guard);
    const { revokeAccountingOAuthGrant } = await import('../../../integrations/src/lib/accountingConnectionAuth');
    await expect(revokeAccountingOAuthGrant({ provider: 'xero', clientId: 'cleanup-app',
      clientSecret: invalidSecret ? 'wrong-secret' : 'cleanup-secret', refreshToken: tokens.refresh_token })).resolves.toBeUndefined();
    expect(blocked).toEqual([]);
    const journal = await (await fetch(`${control}/control/xero/requests`)).json();
    expect(journal.result.complete).toBe(true);
    expect(journal.result.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'POST', path: '/connect/revocation', status: invalidSecret ? 401 : 200 }),
    ]));
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    if (invalidSecret) {
      expect(refreshed.status).toBe(200);
      expect(await (await connections()).json()).toEqual([expect.objectContaining({ tenantId: 'cleanup-org' })]);
      expect(logs.warn).toHaveBeenCalledOnce();
      expect(logs.info).not.toHaveBeenCalled();
    } else {
      expect(refreshed.status).toBe(400);
      expect(await refreshed.json()).toEqual({ error: 'invalid_grant' });
      expect((await connections()).status).toBe(401);
      // A new authorization can issue credentials, but cannot resurrect the
      // connected organisations removed by cleanup of the previous grant.
      const newAuthorization = await startAuthorization();
      expect(newAuthorization.status).toBe(302);
      const freshResponse = await tokenRequest({ grant_type: 'authorization_code', redirect_uri: redirectUri,
        code: new URL(newAuthorization.headers.get('location')!).searchParams.get('code')! });
      expect(freshResponse.status).toBe(200);
      const fresh = await freshResponse.json();
      const remainingConnections = await fetch(`${vendor}/connections`, { headers: { authorization: `Bearer ${fresh.access_token}` } });
      expect(remainingConnections.status).toBe(200);
      expect(await remainingConnections.json()).toEqual([]);
      expect(logs.info).toHaveBeenCalledOnce();
      expect(logs.warn).not.toHaveBeenCalled();
    }
  } finally {
    removeGuard();
    if (previous === undefined) delete process.env.XERO_OAUTH_REVOKE_URL;
    else process.env.XERO_OAUTH_REVOKE_URL = previous;
    vi.resetModules();
    if (started) await host.stop();
  }
});
