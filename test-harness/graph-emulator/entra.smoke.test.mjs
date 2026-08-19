import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const emulatorPort = 14020;
const base = `http://127.0.0.1:${emulatorPort}`;
const CONTOSO = '22222222-2222-4222-8222-222222222222';
let emulator;
let accessToken;

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function graph(path, headers = {}) {
  // managedTenants lives on beta, as on real Graph; everything else on v1.0.
  const version = path.startsWith('/tenantRelationships/managedTenants') ? 'beta' : 'v1.0';
  return fetch(`${base}/${version}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, ...headers },
  });
}

before(async () => {
  emulator = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      PORT: String(emulatorPort),
      MICROSOFT_CLIENT_ID: 'alga-dev',
      MICROSOFT_CLIENT_SECRET: 'alga-dev-secret',
    },
    stdio: 'ignore',
  });
  await waitFor(`${base}/__control/entra/state`);

  // The connect flow Alga performs: authorize, then exchange the code.
  const authorize = new URL(`${base}/common/oauth2/v2.0/authorize`);
  authorize.search = new URLSearchParams({
    client_id: 'alga-dev',
    redirect_uri: 'http://localhost/callback',
    state: 'state',
  });
  const authResponse = await fetch(authorize, { redirect: 'manual' });
  const code = new URL(authResponse.headers.get('location')).searchParams.get('code');
  const tokenResponse = await fetch(`${base}/common/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'alga-dev',
      client_secret: 'alga-dev-secret',
      code,
      redirect_uri: 'http://localhost/callback',
      grant_type: 'authorization_code',
    }),
  });
  accessToken = (await tokenResponse.json()).access_token;
  assert.ok(accessToken, 'expected an access token from the emulated token endpoint');
});

after(() => {
  emulator?.kill('SIGTERM');
});

test('boots with a managed-tenant directory the wizard can discover', async () => {
  const response = await graph('/tenantRelationships/managedTenants/tenants?$top=999');
  assert.equal(response.status, 200);
  const payload = await response.json();
  const names = payload.value.map((tenant) => tenant.displayName).sort();
  assert.deepEqual(names, ['Contoso Ltd', 'Fabrikam Residential', 'Northwind Traders']);
  // The mapping table matches on domain, so every tenant needs one.
  assert.ok(payload.value.every((tenant) => tenant.defaultDomainName));
  assert.equal(payload.value.find((t) => t.tenantId === CONTOSO).userCount, 6);
});

test('the probe endpoint answers before anything is persisted', async () => {
  const response = await graph('/tenantRelationships/managedTenants/tenants?$top=1');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).value.length, 1);
});

test('an unknown token is rejected, so a failed probe is reachable', async () => {
  const response = await fetch(`${base}/beta/tenantRelationships/managedTenants/tenants`, {
    headers: { authorization: 'Bearer not-a-token' },
  });
  assert.equal(response.status, 401);
});

test('managedTenants on v1.0 answers 400 like real Graph, so the endpoint-version bug stays dead', async () => {
  const response = await fetch(`${base}/v1.0/tenantRelationships/managedTenants/tenants?$top=1`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, 'BadRequest');
});

test('users come back per tenant, including the disabled account', async () => {
  const filter = encodeURIComponent(`tenantId eq '${CONTOSO}'`);
  const response = await graph(`/tenantRelationships/managedTenants/users?$filter=${filter}&$top=999`);
  const users = (await response.json()).value;

  assert.equal(users.length, 6);
  assert.ok(users.every((user) => user.tenantId === CONTOSO));

  const disabled = users.filter((user) => user.accountEnabled === false);
  assert.deepEqual(disabled.map((user) => user.mail), ['charles.babbage@contoso.com']);

  // A service account with no mailbox: the sync's no-email path is reachable.
  assert.ok(users.some((user) => user.mail === null && user.userPrincipalName));
});

test('pages with @odata.nextLink so the adapters have to follow it', async () => {
  const filter = encodeURIComponent(`tenantId eq '${CONTOSO}'`);
  let url = `${base}/beta/tenantRelationships/managedTenants/users?$filter=${filter}&$top=2`;
  const seen = [];
  let pages = 0;

  while (url) {
    const payload = await (await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })).json();
    seen.push(...payload.value.map((user) => user.id));
    url = payload['@odata.nextLink'] || '';
    pages += 1;
    assert.ok(pages < 10, 'paging did not terminate');
  }

  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 6);
});

test('self-tenant smoke mode has an organization and its own users', async () => {
  const organization = (await (await graph('/organization?$top=1')).json()).value;
  assert.equal(organization.length, 1);
  assert.equal(organization[0].displayName, 'Delgado IT');
  assert.ok(organization[0].verifiedDomains.some((domain) => domain.isDefault));

  const users = (await (await graph('/users?$top=999')).json()).value;
  assert.deepEqual(users.map((user) => user.mail).sort(), [
    'rae@delgado-it.com',
    'sam@delgado-it.com',
  ]);
});

test('CIPP reads the same directory over its own API', async () => {
  const headers = { 'x-api-key': 'cipp-dev-key' };

  const tenants = await (await fetch(`${base}/api/listtenants`, { headers })).json();
  assert.equal(tenants.length, 3);
  assert.ok(tenants.every((tenant) => tenant.customerId && tenant.defaultDomainName));

  const users = await (await fetch(`${base}/api/listusers?tenantId=${CONTOSO}`, { headers })).json();
  assert.equal(users.length, 6);

  // An endpoint CIPP deployments may not have: the adapter falls through to the
  // next candidate on 404 rather than failing the connection.
  const missing = await fetch(`${base}/api/tenant/list`, { headers });
  assert.equal(missing.status, 404);
});

test('a pinned CIPP key makes a wrong credential a 401, not a silent success', async () => {
  await fetch(`${base}/__control/entra/cipp-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'the-right-key' }),
  });

  const wrong = await fetch(`${base}/api/listtenants`, { headers: { 'x-api-key': 'the-wrong-key' } });
  assert.equal(wrong.status, 401);

  const right = await fetch(`${base}/api/listtenants`, { headers: { 'x-api-key': 'the-right-key' } });
  assert.equal(right.status, 200);

  await fetch(`${base}/__control/entra/cipp-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: null }),
  });
});

test('offboarding a user flips accountEnabled for the next sync', async () => {
  const response = await fetch(`${base}/__control/entra/users/disable`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mail: 'ada.lovelace@contoso.com' }),
  });
  assert.deepEqual(await response.json(), { ok: true, changed: 1, accountEnabled: false });

  const filter = encodeURIComponent(`tenantId eq '${CONTOSO}'`);
  const users = (await (await graph(`/tenantRelationships/managedTenants/users?$filter=${filter}&$top=999`)).json()).value;
  assert.equal(users.find((user) => user.mail === 'ada.lovelace@contoso.com').accountEnabled, false);
});
