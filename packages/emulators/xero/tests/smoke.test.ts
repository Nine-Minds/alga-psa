import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { EmulatorHost } from '@alga-psa/emulator-host';
import xeroEmulator from '../src/index';

let host: EmulatorHost;
let base: string;
let control: string;

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

function api(path: string): string {
  return `${base}/api.xro/2.0${path}`;
}

const SCOPE = 'offline_access accounting.settings.read accounting.invoices accounting.contacts';

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [xeroEmulator], controlPort: 0, ports: { xero: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.xero}`;
  control = `http://127.0.0.1:${controlPort}`;
  for (const app of [
    { type: 'confidential', clientId: 'alga-app', clientSecret: 'alga-secret', redirectUris: ['http://localhost/api/integrations/xero/callback'] },
    { type: 'confidential', clientId: 'bound-app', clientSecret: 'synthetic-secret', redirectUris: ['http://localhost/bound-callback'] },
    { type: 'pkce', clientId: 'pkce-app', redirectUris: ['http://localhost/pkce-callback'] },
  ]) expect((await controlPost('/control/xero/seed/application', app)).ok).toBe(true);
});

afterAll(async () => {
  await host.stop();
});

// Tests narrate one protocol session (the OAuth flow mints the token the later
// entity tests reuse); opt out of any intra-file shuffle.
describe('xero emulator', { shuffle: false }, () => {
  let accessToken: string;
  let tenantId: string;

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'content-type': 'application/json',
      ...extra,
    };
  }

  it('completes the Xero OAuth flow: authorize, code exchange with scope echo, refresh rotation', async () => {
    const authorize = new URL(`${base}/identity/connect/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: 'alga-app',
      redirect_uri: 'http://localhost/api/integrations/xero/callback',
      scope: SCOPE,
      state: 'csrf-state',
    }).toString();
    const redirect = await fetch(authorize, { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    const callback = new URL(redirect.headers.get('location')!);
    expect(callback.pathname).toBe('/api/integrations/xero/callback');
    expect(callback.searchParams.get('state')).toBe('csrf-state');
    const code = callback.searchParams.get('code')!;
    expect(code).toBeTruthy();

    // The authorize request (including the exact scope string) is observable.
    const recorded = (await (await fetch(`${control}/control/xero/state/authorize-requests`)).json()) as any;
    expect(recorded.result.at(-1)).toMatchObject({ clientId: 'alga-app', scope: SCOPE, state: 'csrf-state' });

    const exchanged = await fetch(`${base}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost/api/integrations/xero/callback',
        client_id: 'alga-app',
        client_secret: 'alga-secret',
      }),
    });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.scope).toBe(SCOPE); // scope echo of the requested scope string
    expect(tokens.expires_in).toBeGreaterThan(0);

    const refreshed = await fetch(`${base}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: 'alga-app',
        client_secret: 'alga-secret',
      }),
    });
    expect(refreshed.status).toBe(200);
    const rotated = await refreshed.json();
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(rotated.scope).toBe(SCOPE);

    const reuse = await fetch(`${base}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toEqual({ error: 'invalid_grant' });

    accessToken = rotated.access_token;
  });

  it('binds codes and refresh tokens to the originating client and redirect', async () => {
    const redirectUri = 'http://localhost/bound-callback';
    const authorize = new URL(`${base}/identity/connect/authorize`);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: 'bound-app', redirect_uri: redirectUri }).toString();
    const response = await fetch(authorize, { redirect: 'manual' });
    const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
    const exchange = (body: Record<string, string>, basic?: string) => fetch(`${base}/connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(basic ? { authorization: `Basic ${Buffer.from(basic).toString('base64')}` } : {}) },
      body: new URLSearchParams(body),
    });
    const request = { grant_type: 'authorization_code', code, client_id: 'bound-app', client_secret: 'synthetic-secret', redirect_uri: redirectUri };
    for (const patch of [{ client_id: 'different-app' }, { client_id: '' }, { redirect_uri: 'http://localhost/different' }]) {
      const denied = await exchange({ ...request, ...patch });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual({ error: 'invalid_grant' });
    }
    const wrongSecret = await exchange({ ...request, client_secret: 'wrong-secret' });
    expect(wrongSecret.status).toBe(401);
    expect(await wrongSecret.json()).toEqual({ error: 'invalid_client' });
    const valid = await exchange(request);
    expect(valid.status).toBe(200);
    const token = await valid.json();
    const refresh = { grant_type: 'refresh_token', refresh_token: token.refresh_token };
    for (const client_id of ['different-app', '']) {
      const denied = await exchange({ ...refresh, client_id });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual({ error: 'invalid_grant' });
    }
    const wrongRefreshSecret = await exchange(refresh, 'bound-app:wrong-secret');
    expect(wrongRefreshSecret.status).toBe(401);
    expect(await wrongRefreshSecret.json()).toEqual({ error: 'invalid_client' });
    const rotated = await exchange(refresh, 'bound-app:synthetic-secret');
    expect(rotated.status).toBe(200);
    expect((await rotated.json()).refresh_token).not.toBe(token.refresh_token);
    expect((await exchange(request)).status).toBe(400);
  });

  it('requires the S256 verifier before exchanging a PKCE authorization code', async () => {
    const verifier = 'synthetic-verifier-'.repeat(4);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'http://localhost/pkce-callback';
    const query = { response_type: 'code', client_id: 'pkce-app', redirect_uri: redirectUri,
      code_challenge: challenge, code_challenge_method: 'S256' };
    const authorize = async (params: Record<string, string>) => fetch(`${base}/identity/connect/authorize?${new URLSearchParams(params)}`, { redirect: 'manual' });
    for (const patch of [{ code_challenge_method: 'plain' }, { code_challenge: '' }, { code_challenge: 'invalid' }, { client_id: 'unknown' }, { redirect_uri: 'http://localhost/unregistered' }]) {
      expect((await authorize({ ...query, ...patch })).status).toBe(400);
    }
    const { code_challenge: _challenge, code_challenge_method: _method, ...withoutPkce } = query;
    expect((await authorize(withoutPkce)).status).toBe(400);
    const granted = await authorize(query);
    expect(granted.status).toBe(302);
    const code = new URL(granted.headers.get('location')!).searchParams.get('code')!;
    const exchange = (code_verifier: string) => fetch(`${base}/connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'pkce-app', redirect_uri: redirectUri, code, code_verifier }),
    });
    for (const wrong of ['', 'different-verifier-'.repeat(4), 'short']) {
      const denied = await exchange(wrong);
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual({ error: 'invalid_grant' });
    }
    const valid = await exchange(verifier);
    expect(valid.status).toBe(200);
    expect((await valid.json()).access_token).toEqual(expect.any(String));
    expect((await exchange(verifier)).status).toBe(400);
  });

  it('lists connected organisations, including seeded additional ones', async () => {
    const seeded = await controlPost('/control/xero/seed/organisation', { tenantName: 'Second Org Ltd' });
    expect(seeded.ok).toBe(true);

    const response = await fetch(`${base}/connections`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.status).toBe(200);
    const connections = (await response.json()) as any[];
    expect(connections).toHaveLength(2);
    for (const connection of connections) {
      expect(connection).toMatchObject({ tenantType: 'ORGANISATION' });
      expect(connection.id).toBeTruthy();
      expect(connection.tenantId).toBeTruthy();
    }
    expect(connections.map((c) => c.tenantName)).toContain('Second Org Ltd');
    const selected = await controlPost('/control/xero/actions/select-organisation', { xeroTenantId: seeded.result.tenantId });
    expect(selected.ok).toBe(true);
    const readConnections = async () => (await fetch(`${base}/connections`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })).json();
    const reordered = await readConnections();
    expect(reordered).toEqual([connections[1], connections[0]]);
    expect((await controlPost('/control/xero/actions/select-organisation', { xeroTenantId: 'unconnected' })).ok).toBe(false);
    expect(await readConnections()).toEqual(reordered);
    tenantId = reordered[0].tenantId;
  });

  it('serves the read-only settings collections', async () => {
    const accounts = (await (await fetch(api('/Accounts'), { headers: authed() })).json()) as any;
    expect(accounts.Accounts.length).toBeGreaterThan(0);
    expect(accounts.Accounts[0].AccountID).toBeTruthy();

    const taxRates = (await (await fetch(api('/TaxRates'), { headers: authed() })).json()) as any;
    expect(taxRates.TaxRates[0].TaxComponents.length).toBeGreaterThan(0);

    const items = (await (await fetch(api('/Items'), { headers: authed() })).json()) as any;
    expect(items.Items[0].Code).toBeTruthy();

    const tracking = (await (await fetch(api('/TrackingCategories'), { headers: authed() })).json()) as any;
    expect(tracking.TrackingCategories[0].Options.length).toBeGreaterThan(0);
  });

  it('creates and fetches contacts, honouring the Name== where clause', async () => {
    const created = await fetch(api('/Contacts'), {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ Contacts: [{ Name: 'Acme Rockets', EmailAddress: 'ap@acme.test' }] }),
    });
    expect(created.status).toBe(200);
    const contact = ((await created.json()) as any).Contacts[0];
    expect(contact.ContactID).toBeTruthy();

    const where = encodeURIComponent('Name=="Acme Rockets"');
    const found = (await (await fetch(api(`/Contacts?where=${where}`), { headers: authed() })).json()) as any;
    expect(found.Contacts).toHaveLength(1);
    expect(found.Contacts[0].ContactID).toBe(contact.ContactID);

    const missing = (await (
      await fetch(api(`/Contacts?where=${encodeURIComponent('Name=="Nobody Here"')}`), { headers: authed() })
    ).json()) as any;
    expect(missing.Contacts).toHaveLength(0);
  });

  it('creates an invoice, assigns InvoiceID/InvoiceNumber, and serves it back', async () => {
    const contactId = ((await (
      await fetch(api(`/Contacts?where=${encodeURIComponent('Name=="Acme Rockets"')}`), { headers: authed() })
    ).json()) as any).Contacts[0].ContactID;

    const created = await fetch(api('/Invoices'), {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({
        Invoices: [
          {
            Type: 'ACCREC',
            Contact: { ContactID: contactId },
            LineAmountTypes: 'Exclusive',
            LineItems: [{ Description: 'Managed services', Quantity: 1, UnitAmount: 150, LineAmount: 150 }],
          },
        ],
      }),
    });
    expect(created.status).toBe(200);
    const invoice = ((await created.json()) as any).Invoices[0];
    expect(invoice.InvoiceID).toBeTruthy();
    expect(invoice.InvoiceNumber).toMatch(/^INV-/);
    expect(invoice.LineItems[0].LineItemID).toBeTruthy();

    const fetched = await fetch(api(`/Invoices/${invoice.InvoiceID}`), { headers: authed() });
    expect(fetched.status).toBe(200);
    const read = ((await fetched.json()) as any).Invoices[0];
    expect(read.InvoiceID).toBe(invoice.InvoiceID);
    expect(read.LineItems[0].Description).toBe('Managed services');

    const missing = await fetch(api('/Invoices/nope'), { headers: authed() });
    expect(missing.status).toBe(404);
  });

  it('mirrors live Xero line catalog validation: bogus ItemCode rejected, account-code-only line accepted', async () => {
    const contactId = ((await (
      await fetch(api(`/Contacts?where=${encodeURIComponent('Name=="Acme Rockets"')}`), { headers: authed() })
    ).json()) as any).Contacts[0].ContactID;

    const invoiceFor = (line: Record<string, unknown>) => ({
      Invoices: [
        {
          Type: 'ACCREC',
          Contact: { ContactID: contactId },
          LineAmountTypes: 'Exclusive',
          LineItems: [{ Description: 'IT Professional Services', Quantity: 1, UnitAmount: 150, LineAmount: 150, ...line }],
        },
      ],
    });

    // The alga0002321 failure: an account code sent as ItemCode.
    const badItem = await fetch(api('/Invoices'), {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify(invoiceFor({ ItemCode: '200', TaxType: 'OUTPUT' })),
    });
    expect(badItem.status).toBe(400);
    const badBody = (await badItem.json()) as any;
    expect(JSON.stringify(badBody)).toContain("Item code '200' is not valid");

    // Archived account code is rejected too.
    const archivedAccount = await fetch(api('/Invoices'), {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify(invoiceFor({ AccountCode: '299' })),
    });
    expect(archivedAccount.status).toBe(400);

    // Account-code-only line (no ItemCode property) is valid.
    const accountOnly = await fetch(api('/Invoices'), {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify(invoiceFor({ AccountCode: '200', TaxType: 'OUTPUT' })),
    });
    expect(accountOnly.status).toBe(200);
    const accepted = ((await accountOnly.json()) as any).Invoices[0];
    expect(accepted.LineItems[0].AccountCode).toBe('200');
    expect(accepted.LineItems[0].ItemCode).toBeUndefined();
  });

  it('401s expired access tokens until a refresh mints a new one', async () => {
    const expired = await controlPost('/control/xero/actions/expire-access-tokens');
    expect(expired.ok).toBe(true);

    const rejected = await fetch(api('/Accounts'), { headers: authed() });
    expect(rejected.status).toBe(401);

    const tokensView = (await (await fetch(`${control}/control/xero/state/tokens`)).json()) as any;
    const refreshRecord = tokensView.result.refreshTokens.at(-1);
    const refreshToken = refreshRecord.token;
    const refreshed = await fetch(`${base}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: refreshRecord.clientId }),
    });
    expect(refreshed.status).toBe(200);
    accessToken = (await refreshed.json()).access_token;

    const accepted = await fetch(api('/Accounts'), { headers: authed() });
    expect(accepted.status).toBe(200);
  });

  it('rejects unknown bearer tokens and unconnected tenants', async () => {
    const unknown = await fetch(api('/Accounts'), {
      headers: { authorization: 'Bearer nope', 'xero-tenant-id': tenantId },
    });
    expect(unknown.status).toBe(401);

    const wrongTenant = await fetch(api('/Accounts'), { headers: authed({ 'xero-tenant-id': 'not-a-tenant' }) });
    expect(wrongTenant.status).toBe(403);
  });
  it('reset removes registered applications and their issued credentials', async () => {
    expect((await controlPost('/control/xero/reset')).ok).toBe(true);
    const query = new URLSearchParams({ response_type: 'code', client_id: 'alga-app', redirect_uri: 'http://localhost/api/integrations/xero/callback' });
    expect((await fetch(`${base}/identity/connect/authorize?${query}`, { redirect: 'manual' })).status).toBe(400);
    expect((await fetch(`${base}/connections`, { headers: { authorization: `Bearer ${accessToken}` } })).status).toBe(401);
  });

});
