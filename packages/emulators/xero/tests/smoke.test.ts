import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    tenantId = connections[0].tenantId;
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

  it('401s expired access tokens until a refresh mints a new one', async () => {
    const expired = await controlPost('/control/xero/actions/expire-access-tokens');
    expect(expired.ok).toBe(true);

    const rejected = await fetch(api('/Accounts'), { headers: authed() });
    expect(rejected.status).toBe(401);

    const tokensView = (await (await fetch(`${control}/control/xero/state/tokens`)).json()) as any;
    const refreshToken = tokensView.result.refreshTokens.at(-1).token;
    const refreshed = await fetch(`${base}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
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
});
