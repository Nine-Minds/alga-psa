import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// The real token service and message helpers, run against the emulator. Node
// strips the types; both files are dependency-free by design.
const cippDir = '../../ee/server/src/lib/integrations/entra/providers/cipp';
const { CippTokenService, cippTokenCacheKey } = await import(`${cippDir}/cippTokenService.ts`);
const { looksLikeHtml } = await import(`${cippDir}/cippFailureMessages.ts`);

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

// ---------------------------------------------------------------------------
// CIPP API client (client-credentials) mode
// ---------------------------------------------------------------------------

const CLIENT = {
  clientId: 'cipp-api-client-id',
  clientSecret: 'cipp-api-client-secret-VALUE',
  directoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

async function control(path, payload) {
  const response = await fetch(`${base}/__control/entra/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return response.json();
}

async function apiClientMode() {
  await control('cipp-faults', { reset: true });
  await control('cipp-client', {
    tenantId: CLIENT.directoryId,
    clientId: CLIENT.clientId,
    clientSecret: CLIENT.clientSecret,
  });
}

async function legacyMode() {
  await control('cipp-faults', { reset: true });
  await control('cipp-client', { clientId: null });
}

async function mintFailure(overrides = {}, authority = base) {
  const service = new CippTokenService({ authorityBaseUrl: authority });
  try {
    await service.getToken('t', { ...CLIENT, ...overrides });
  } catch (error) {
    return error;
  }
  assert.fail('expected the mint to fail');
}

test('api-client mode: a minted Bearer token reads the directory, and an X-API-KEY alone is a 401', async () => {
  await apiClientMode();
  try {
    const service = new CippTokenService({ authorityBaseUrl: base });
    const token = await service.getToken('t', CLIENT);
    const headers = { authorization: `Bearer ${token}` };

    const tenants = await (await fetch(`${base}/api/listtenants`, { headers })).json();
    assert.ok(tenants.length >= 3);
    const mailboxes = await fetch(`${base}/api/ListMailboxes?tenantFilter=${CONTOSO}`, { headers });
    assert.equal(mailboxes.status, 200);

    const keyOnly = await fetch(`${base}/api/listtenants`, { headers: { 'x-api-key': 'cipp-dev-key' } });
    assert.equal(keyOnly.status, 401);
    const state = await (await fetch(`${base}/__control/entra/state`)).json();
    assert.equal(state.cippApiClientMode, true);
  } finally {
    await legacyMode();
  }
});

test('api-client mode: a long sync re-mints past a short expires_in, proactively and after a 401', async () => {
  await apiClientMode();
  try {
    await control('cipp-faults', { tokenTtlSeconds: 2 });
    let offsetMs = 0;
    // The service's clock runs ahead of the emulator's, standing in for a sync
    // that outlives the token. skew 1s of a 2s token: usable for about a second.
    const service = new CippTokenService({
      authorityBaseUrl: base,
      skewMs: 1000,
      now: () => Date.now() + offsetMs,
    });
    const list = async (token) => (await fetch(`${base}/api/listtenants`, {
      headers: { authorization: `Bearer ${token}` },
    })).status;

    const first = await service.getToken('t', CLIENT);
    assert.equal(await list(first), 200);
    assert.equal(await service.getToken('t', CLIENT), first, 'still cached');

    offsetMs = 1500; // inside the skew window: re-mint before it can 401
    const second = await service.getToken('t', CLIENT);
    assert.notEqual(second, first);
    assert.equal(await list(second), 200);

    // Real expiry on the emulator's side: the old token 401s, a fresh one works.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    assert.equal(await list(second), 401);
    service.invalidate(cippTokenCacheKey('t', CLIENT), second);
    const third = await service.getToken('t', CLIENT);
    assert.equal(await list(third), 200);

    // Revocation (401 with a token the service still thinks is good).
    await control('cipp-revoke-tokens');
    assert.equal(await list(third), 401);
    service.invalidate(cippTokenCacheKey('t', CLIENT), third);
    assert.equal(await list(await service.getToken('t', CLIENT)), 200);

    const state = await (await fetch(`${base}/__control/entra/state`)).json();
    assert.equal(state.cippMintCount, 4);
  } finally {
    await legacyMode();
  }
});

test('api-client faults at the token endpoint each produce a distinct error', async () => {
  await apiClientMode();
  try {
    const badSecret = await mintFailure({ clientSecret: 'the-secret-id-not-the-value' });
    assert.equal(badSecret.aadstsCode, 'AADSTS7000215');
    assert.equal(badSecret.category, 'invalid_secret');
    assert.match(badSecret.message, /secret ID instead of its Value/);

    const wrongClient = await mintFailure({ clientId: 'not-a-client' });
    assert.equal(wrongClient.aadstsCode, 'AADSTS700016');
    const wrongTenant = await mintFailure({ directoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    assert.equal(wrongTenant.aadstsCode, 'AADSTS700016');
    assert.match(wrongTenant.message, /Check the Application \(client\) ID and the Tenant/);

    await control('cipp-faults', { tenantNotFound: true });
    const noTenant = await mintFailure();
    assert.equal(noTenant.aadstsCode, 'AADSTS90002');
    assert.match(noTenant.message, /15 minutes/);

    await control('cipp-faults', { reset: true });
    await control('cipp-faults', { missingIdentifierUri: true });
    const noUri = await mintFailure();
    assert.equal(noUri.code, 'token-scope-rejected');
    assert.match(noUri.message, /Repair Identifier URI/);

    await control('cipp-faults', { reset: true });
    await control('cipp-faults', { consentRequired: true });
    const consent = await mintFailure();
    assert.equal(consent.category, 'consent_required');

    // None of them leak the secret.
    for (const error of [badSecret, wrongClient, wrongTenant, noTenant, noUri, consent]) {
      assert.ok(!error.message.includes(CLIENT.clientSecret));
    }
  } finally {
    await legacyMode();
  }
});

test('api-client faults at the CIPP API: IP block, role block and an HTML page are distinguishable', async () => {
  await apiClientMode();
  try {
    const service = new CippTokenService({ authorityBaseUrl: base });
    const headers = { authorization: `Bearer ${await service.getToken('t', CLIENT)}` };
    const get = (path) => fetch(`${base}${path}?tenantFilter=${CONTOSO}`, { headers });

    // Role-blocked: one endpoint 403s while listtenants still answers.
    await control('cipp-faults', { blockedEndpoints: ['listusers'] });
    assert.equal((await get('/api/listusers')).status, 403);
    assert.equal((await get('/api/listtenants')).status, 200);
    assert.equal((await get('/api/listgroups')).status, 200);

    // IP-blocked: everything 403s, listtenants included.
    await control('cipp-faults', { reset: true });
    await control('cipp-faults', { ipBlocked: true });
    assert.equal((await get('/api/listtenants')).status, 403);
    assert.equal((await get('/api/listusers')).status, 403);

    // HTML where /api should be.
    await control('cipp-faults', { reset: true });
    await control('cipp-faults', { htmlAtApi: true });
    const html = await get('/api/listtenants');
    assert.equal(html.status, 200);
    assert.ok(looksLikeHtml(html.headers.get('content-type'), await html.text()));
  } finally {
    await legacyMode();
  }
});

test('legacy api-key mode still works after API-client mode is switched off', async () => {
  await apiClientMode();
  await legacyMode();
  const response = await fetch(`${base}/api/listtenants`, { headers: { 'x-api-key': 'any-key' } });
  assert.equal(response.status, 200);
  const state = await (await fetch(`${base}/__control/entra/state`)).json();
  assert.equal(state.cippApiClientMode, false);
});
