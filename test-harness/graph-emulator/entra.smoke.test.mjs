import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const emulatorPort = 14020;
const base = `http://127.0.0.1:${emulatorPort}`;
const CONTOSO = '22222222-2222-4222-8222-222222222222';
let emulator;
let accessToken;
let refreshToken;

/**
 * The GDAP read pattern the direct adapter uses: redeem the partner's refresh
 * token against a CUSTOMER tenant's authority, and read that tenant's
 * directory with the resulting token.
 */
async function tokenForTenant(tenantId) {
  const response = await fetch(`${base}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'alga-dev',
      client_secret: 'alga-dev-secret',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json();
  refreshToken = payload.refresh_token || refreshToken;
  return payload.access_token;
}

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
  const tokens = await tokenResponse.json();
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  assert.ok(accessToken, 'expected an access token from the emulated token endpoint');
  assert.ok(refreshToken, 'expected a refresh token from the emulated token endpoint');
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

test('managedTenants has no users segment, exactly like real Graph', async () => {
  // The endpoint this emulator once invented; production synced against it and
  // failed 100% of the time against real Microsoft. It must stay a 400.
  const filter = encodeURIComponent(`tenantId eq '${CONTOSO}'`);
  const response = await graph(`/tenantRelationships/managedTenants/users?$filter=${filter}&$top=999`);
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, 'BadRequest');
  assert.match(payload.error.message, /Resource not found for the segment/);
});

test('a customer-authority token reads that tenant, including the disabled account', async () => {
  const contosoToken = await tokenForTenant(CONTOSO);
  const response = await fetch(`${base}/v1.0/users?$top=999`, {
    headers: { authorization: `Bearer ${contosoToken}` },
  });
  const users = (await response.json()).value;

  assert.equal(users.length, 6);
  // Real /users rows carry no tenantId — the sync must not rely on one.
  assert.ok(users.every((user) => user.tenantId === undefined));

  const disabled = users.filter((user) => user.accountEnabled === false);
  assert.deepEqual(disabled.map((user) => user.mail), ['charles.babbage@contoso.com']);

  // A service account with no mailbox: the sync's no-email path is reachable.
  assert.ok(users.some((user) => user.mail === null && user.userPrincipalName));
});

test('pages with @odata.nextLink so the adapters have to follow it', async () => {
  const contosoToken = await tokenForTenant(CONTOSO);
  let url = `${base}/v1.0/users?$top=2`;
  const seen = [];
  let pages = 0;

  while (url) {
    const payload = await (await fetch(url, { headers: { authorization: `Bearer ${contosoToken}` } })).json();
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

  // Faithful to real CIPP: a tenant row is identified by customerId only — no
  // invented tenantId or userCount for production to lean on.
  const tenants = await (await fetch(`${base}/api/listtenants`, { headers })).json();
  assert.equal(tenants.length, 3);
  assert.ok(tenants.every((tenant) => tenant.customerId && tenant.defaultDomainName));
  assert.ok(tenants.every((tenant) => tenant.tenantId === undefined && tenant.userCount === undefined));

  const users = await (await fetch(`${base}/api/listusers?tenantFilter=${CONTOSO}`, { headers })).json();
  assert.equal(users.length, 6);
  assert.ok(users.every((user) => user.tenantId === undefined));

  // Faithful to real CIPP source ($Request.Query.tenantFilter); the tenantId
  // param production once sent is not a substitute.
  const wrongParam = await fetch(`${base}/api/listusers?tenantId=${CONTOSO}`, { headers });
  assert.equal(wrongParam.status, 400);

  // An endpoint CIPP deployments may not have: the adapter falls through to the
  // next candidate on 404 rather than failing the connection.
  const missing = await fetch(`${base}/api/tenant/list`, { headers });
  assert.equal(missing.status, 404);
});

test('CIPP serves groups and user-group membership over the same directory', async () => {
  const headers = { 'x-api-key': 'cipp-dev-key' };

  const groups = await (await fetch(`${base}/api/listgroups?tenantFilter=${CONTOSO}`, { headers })).json();
  assert.equal(groups.length, 2);
  const securityGroup = groups.find((group) => group.securityEnabled === true);
  assert.equal(securityGroup.displayName, 'Contoso Synced Staff');

  const users = await (await fetch(`${base}/api/listusers?tenantFilter=${CONTOSO}`, { headers })).json();
  const ada = users.find((user) => user.mail === 'ada.lovelace@contoso.com');
  const memberships = await (await fetch(
    `${base}/api/listusergroups?tenantFilter=${CONTOSO}&userId=${ada.id}`,
    { headers },
  )).json();
  // ListUserGroups rows carry a lowercase id but PascalCase display fields —
  // exactly the projection Invoke-ListUserGroups.ps1 makes.
  const membership = memberships.find((group) => group.id === securityGroup.id);
  assert.ok(membership);
  assert.equal(membership.SecurityGroup, true);
  assert.equal(membership.displayName, undefined);
});

test('a customer-authority token lists groups and checks membership like real Graph', async () => {
  const contosoToken = await tokenForTenant(CONTOSO);
  const graphHeaders = { authorization: `Bearer ${contosoToken}` };

  const groups = (await (await fetch(`${base}/v1.0/groups?$select=id,displayName,securityEnabled&$top=200`, {
    headers: graphHeaders,
  })).json()).value;
  assert.equal(groups.length, 2);
  const securityGroup = groups.find((group) => group.securityEnabled === true);
  const distributionGroup = groups.find((group) => group.securityEnabled === false);
  assert.ok(securityGroup && distributionGroup);

  const users = (await (await fetch(`${base}/v1.0/users?$top=999`, { headers: graphHeaders })).json()).value;
  const ada = users.find((user) => user.mail === 'ada.lovelace@contoso.com');
  const alan = users.find((user) => user.mail === 'alan.turing@contoso.com');

  const check = async (userId) => (await (await fetch(`${base}/v1.0/users/${userId}/checkMemberGroups`, {
    method: 'POST',
    headers: { ...graphHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ groupIds: [securityGroup.id, distributionGroup.id, 'not-a-group'] }),
  })).json()).value;

  // Ada is in both seeded groups; Alan only in the distribution group.
  assert.deepEqual((await check(ada.id)).sort(), [securityGroup.id, distributionGroup.id].sort());
  assert.deepEqual(await check(alan.id), [distributionGroup.id]);
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

  const contosoToken = await tokenForTenant(CONTOSO);
  const users = (await (await fetch(`${base}/v1.0/users?$top=999`, {
    headers: { authorization: `Bearer ${contosoToken}` },
  })).json()).value;
  assert.equal(users.find((user) => user.mail === 'ada.lovelace@contoso.com').accountEnabled, false);
});
