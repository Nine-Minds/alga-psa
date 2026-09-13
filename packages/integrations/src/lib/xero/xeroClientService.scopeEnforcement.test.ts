import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  XeroClientService,
  getXeroOAuthScopesString,
  XERO_PAYMENT_READ_SCOPE
} from './xeroClientService';

/**
 * Real scope-enforcing HTTP boundary (no axios mock): a local server grants
 * Payments only when the bearer token's stored scope covers the payment read
 * scope, mirroring Xero's documented requirement. This ties the shipped
 * default authorization set to actual Payments polling.
 */

const PAYMENT_SCOPES = new Set([
  'accounting.payments',
  'accounting.payments.read',
  'accounting.transactions',
  'accounting.transactions.read'
]);

let server: http.Server;
let baseUrl: string;
const tokenScopes = new Map<string, Set<string>>();

function makeClient(connectionId: string, xeroTenantId: string, scope: string) {
  const client = Object.create(XeroClientService.prototype) as any;
  client.tenantId = 'scope-boundary-tenant';
  client.connection = {
    connectionId,
    xeroTenantId,
    accessToken: `token-${connectionId}`,
    refreshToken: `refresh-${connectionId}`,
    accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
    scope
  };
  client.connections = { [connectionId]: client.connection };
  client.appSecrets = { clientId: 'app-client-id', clientSecret: 'app-client-secret' };
  tokenScopes.set(client.connection.accessToken, new Set(scope.split(/\s+/).filter(Boolean)));
  return client;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/Payments')) {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const scopes = tokenScopes.get(token);
      const authorized = scopes && [...scopes].some((scope) => PAYMENT_SCOPES.has(scope));
      if (!authorized) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ Type: 'Unauthorized', Status: 401 }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Payments: [{ PaymentID: 'pay-boundary-1' }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.XERO_API_BASE_URL = baseUrl;
});

afterAll(async () => {
  delete process.env.XERO_API_BASE_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Xero Payments scope enforcement (real HTTP boundary)', () => {
  it('the shipped default authorization set permits Payments polling', async () => {
    const defaultScope = getXeroOAuthScopesString();
    expect(defaultScope.split(' ')).toContain(XERO_PAYMENT_READ_SCOPE);

    const client = makeClient('conn-fresh', 'tenant-fresh', defaultScope);
    const page = await client.listChangedPayments('2026-01-01T00:00:00.000Z', 1);

    expect(page.records).toHaveLength(1);
  });

  it('a reduced grant that predates the payment scope is denied and classified actionably', async () => {
    const client = makeClient(
      'conn-reduced',
      'tenant-reduced',
      'offline_access accounting.settings.read accounting.invoices accounting.contacts'
    );
    // The client refreshes on 401; stub the refresh so the boundary denial is
    // what surfaces.
    const refresh = Promise.resolve(undefined);
    (client as any).refreshAccessToken = () => refresh;

    await expect(
      client.listChangedPayments('2026-01-01T00:00:00.000Z', 1)
    ).rejects.toMatchObject({
      code: 'XERO_SCOPE_INSUFFICIENT',
      details: { missingScopes: [XERO_PAYMENT_READ_SCOPE] }
    });
  });

  it('a legacy broad transactions grant still polls Payments', async () => {
    const client = makeClient(
      'conn-legacy',
      'tenant-legacy',
      'offline_access accounting.settings accounting.transactions accounting.contacts'
    );
    const page = await client.listChangedPayments('2026-01-01T00:00:00.000Z', 1);
    expect(page.records).toHaveLength(1);
  });
});
