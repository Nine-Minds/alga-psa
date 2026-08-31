/**
 * Live-wire redaction checks: real HTTP against the local accounting provider
 * fault simulator (tools/smoke-sim/accounting-provider-sim.mjs), the real
 * axios stack, and the real @alga-psa/core logger pipeline. Only session,
 * secret storage, and CSRF plumbing are stubbed — the provider error payloads
 * travel the same wire and serialization path they do in production.
 *
 * The simulator loads every failure body with sentinel tokens, secrets,
 * Authorization headers, and customer/invoice data; these assertions prove
 * none of it survives into logger output or thrown application errors while
 * status, stable code, and correlation IDs do.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { NextRequest } from 'next/server';

const SIM_PORT = 18792;
const SIM_BASE = `http://127.0.0.1:${SIM_PORT}`;
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

let simProcess: ChildProcess | null = null;
let sentinels: Record<string, string> = {};

// ---- capture the real logger backend (core logger writes to console) -------
const capturedLogs: string[] = [];
const realConsole = {
  error: console.error,
  warn: console.warn,
  info: console.info,
  log: console.log,
  debug: console.debug
};

function captureConsole() {
  for (const level of Object.keys(realConsole) as Array<keyof typeof realConsole>) {
    console[level] = (...args: unknown[]) => {
      capturedLogs.push(
        args
          .map((arg) => {
            try {
              return typeof arg === 'string' ? arg : JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(' ')
      );
    };
  }
}

function restoreConsole() {
  for (const level of Object.keys(realConsole) as Array<keyof typeof realConsole>) {
    console[level] = realConsole[level];
  }
}

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async (name: string) => {
      if (name === 'xero_client_id' || name === 'qbo_client_id') return 'sim-client-id';
      if (name === 'xero_client_secret' || name === 'qbo_client_secret') {
        return sentinels.clientSecret;
      }
      return undefined;
    },
    getTenantSecret: async () => undefined,
    setTenantSecret: async () => undefined
  }))
}));

const USER_ID = 'user-1';
const CALLBACK_REDIRECT_URI = 'http://localhost:3000/api/integrations/xero/callback';

// Session, CSRF, and the server-side attempt record are plumbing, not part of
// the provider-error path under test — stub them so the callback reaches the
// live token exchange against the simulator.
vi.mock('../../../../lib/xero/xeroOAuthConnectAttemptStore', () => ({
  consumeXeroConnectAttempt: vi.fn(async () => ({
    verifier: 'enc:verifier-ciphertext',
    tenantId: TENANT_ID,
    userId: USER_ID,
    provider: 'xero',
    redirectUri: CALLBACK_REDIRECT_URI,
    csrf: 'csrf-token',
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 60_000
  }))
}));

vi.mock('../../../../lib/xero/xeroOAuthVerifierCipher', () => ({
  decryptXeroVerifier: vi.fn(async () => 'verifier-123')
}));

vi.mock('../../../../lib/accountingConnectionAuth', () => ({
  getAccountingConnectionSessionUser: vi.fn(async () => ({
    tenant: TENANT_ID,
    user_id: USER_ID
  })),
  canManageAccountingConnections: vi.fn(async () => true),
  reauthorizeAccountingOAuthCallback: vi.fn(async () => ({ ok: true })),
  revokeAccountingOAuthGrant: vi.fn(async () => undefined)
}));

vi.mock('../../../../lib/oauth/oauthCsrf', () => ({
  oauthCsrfTokensMatch: () => true,
  buildOauthCsrfCookieOptions: () => ({ path: '/' })
}));

async function waitForSim(): Promise<void> {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const res = await fetch(`${SIM_BASE}/sentinels`);
      if (res.ok) {
        const body = (await res.json()) as { sentinels: Record<string, string> };
        sentinels = body.sentinels;
        return;
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('accounting-provider-sim did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function buildCallbackRequest(): NextRequest {
  // State is an opaque nonce; the stubbed attempt store carries the binding.
  const state = 'opaque-state-nonce';
  const url = `http://localhost:3000/api/integrations/xero/callback?code=auth-code-1&state=${state}`;
  return new NextRequest(url, { headers: { cookie: 'alga_xero_oauth_csrf=csrf-token' } });
}

function allObserved(extra: unknown[]): string {
  return [
    capturedLogs.join('\n'),
    ...extra.map((value) => {
      try {
        const record = value as { message?: string; code?: string; details?: unknown };
        return JSON.stringify({
          message: record?.message,
          code: record?.code,
          details: record?.details
        });
      } catch {
        return String(value);
      }
    })
  ].join('\n');
}

function expectNoSentinels(observed: string) {
  expect(observed).not.toContain('SIMSENTINEL');
  for (const value of Object.values(sentinels)) {
    // Also check each raw sentinel value (auth header value, invoice number…).
    expect(observed).not.toContain(value.replace(/^Bearer /, ''));
  }
}

async function importCallback(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  vi.resetModules();
  return import('./callback');
}

describe('accounting provider error redaction (live wire)', () => {
  beforeAll(async () => {
    const simPath = path.resolve(__dirname, '../../../../../../../tools/smoke-sim/accounting-provider-sim.mjs');
    simProcess = spawn(process.execPath, [simPath, String(SIM_PORT)], { stdio: 'ignore' });
    await waitForSim();
    process.env.EDITION = 'ee';
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
  }, 20000);

  afterAll(() => {
    simProcess?.kill();
  });

  afterEach(() => {
    restoreConsole();
    capturedLogs.length = 0;
  });

  it('redacts a failing Xero token exchange while keeping status and correlation ID', async () => {
    const callback = await importCallback({
      XERO_OAUTH_TOKEN_URL: `${SIM_BASE}/xero/connect/token`,
      XERO_CONNECTIONS_URL: `${SIM_BASE}/xero/connections?scenario=api-error`
    });
    captureConsole();
    const response = await callback.GET(buildCallbackRequest());
    restoreConsole();

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get('location')).toContain('xero_error=oauth_failed');

    const observed = allObserved([]);
    expectNoSentinels(observed);
    expect(observed).toContain('tokenExchange');
    expect(observed).toContain('400');
    expect(observed).toContain('xero-corr-sim-0001');
    expect(observed).toContain('invalid_grant');
  });

  it('treats a malformed 200 token response as sensitive and logs only field names', async () => {
    const callback = await importCallback({
      XERO_OAUTH_TOKEN_URL: `${SIM_BASE}/xero/connect/token?scenario=token-malformed`,
      XERO_CONNECTIONS_URL: `${SIM_BASE}/xero/connections`
    });
    captureConsole();
    const response = await callback.GET(buildCallbackRequest());
    restoreConsole();

    expect(response.headers.get('location')).toContain('xero_error=token_exchange_failed');

    const observed = allObserved([]);
    expectNoSentinels(observed);
    expect(observed).toContain('access_token');
    expect(observed).toContain('refresh_token');
    expect(observed).toContain('missingFields');
  });

  it('redacts a failing Xero accounting API call raised through the client service', async () => {
    process.env.XERO_API_BASE_URL = `${SIM_BASE}/xero/api.xro/2.0`;
    process.env.XERO_OAUTH_TOKEN_URL = `${SIM_BASE}/xero/connect/token`;
    vi.resetModules();
    const { XeroClientService } = await import('../../../../lib/xero/xeroClientService');

    const future = new Date(Date.now() + 3600_000).toISOString();
    const connection = {
      connectionId: 'sim-connection-1',
      xeroTenantId: 'sim-xero-tenant-1',
      tenantName: 'Sim Org',
      accessToken: sentinels.accessToken,
      refreshToken: sentinels.refreshToken,
      accessTokenExpiresAt: future,
      refreshTokenExpiresAt: future
    };
    const service = new (XeroClientService as any)(
      TENANT_ID,
      connection,
      { [connection.connectionId]: connection },
      { clientId: 'sim-client-id', clientSecret: sentinels.clientSecret }
    );

    captureConsole();
    let thrown: unknown;
    try {
      await service.createInvoices([
        {
          invoiceId: 'doc-1',
          invoiceNumber: 'INV-1',
          contactExternalId: 'contact-1',
          issueDate: '2026-01-01',
          lines: []
        }
      ]);
    } catch (error) {
      thrown = error;
    }
    restoreConsole();

    expect(thrown).toBeTruthy();
    const observed = allObserved([thrown]);
    expectNoSentinels(observed);
    expect(observed).toContain('400');
    expect(observed).toContain('xero-corr-sim-0001');
    expect(observed).toContain('XERO_VALIDATION_ERROR');
    expect(observed).toContain('Account code is required');
  });

  it('redacts a failing QBO API call raised through the client service', async () => {
    process.env.QBO_API_BASE_URL = `${SIM_BASE}/qbo/v3/company`;
    process.env.QBO_OAUTH_TOKEN_URL = `${SIM_BASE}/qbo/oauth2/v1/tokens/bearer`;
    vi.resetModules();
    const { QboClientService } = await import('../../../../lib/qbo/qboClientService');

    const future = new Date(Date.now() + 3600_000).toISOString();
    const service = new (QboClientService as any)(TENANT_ID, 'sim-realm-1');
    (service as any).credentials = {
      accessToken: sentinels.accessToken,
      refreshToken: sentinels.refreshToken,
      realmId: 'sim-realm-1',
      accessTokenExpiresAt: future,
      refreshTokenExpiresAt: future
    };

    captureConsole();
    let thrown: unknown;
    try {
      await service.fetchChanges('2026-01-01T00:00:00Z');
    } catch (error) {
      thrown = error;
    }
    restoreConsole();

    expect(thrown).toBeTruthy();
    const observed = allObserved([thrown]);
    expectNoSentinels(observed);
    expect(observed).toContain('400');
    expect(observed).toContain('intuit-tid-sim-0001');
    expect(observed).toContain('6000');
  });
});
