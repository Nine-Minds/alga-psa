import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import qboEmulator from '../src/index';

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
  return `${base}/v3/company/realm-sim${path}`;
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [qboEmulator], controlPort: 0, ports: { qbo: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.qbo}`;
  control = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  await host.stop();
});

// Tests narrate one protocol session (OAuth flow mints the token the later
// entity tests reuse); opt out of the server suite's intra-file shuffle.
describe('qbo emulator', { shuffle: false }, () => {
  let accessToken: string;
  let refreshToken: string;
  let authed: { authorization: string; 'content-type': string };

  it('completes the Intuit OAuth flow: authorize, code exchange, refresh rotation', async () => {
    await controlPost('/control/qbo/seed/client', { clientId: 'alga-app', clientSecret: 'alga-secret' });

    const authorize = new URL(`${base}/connect/oauth2`);
    authorize.search = new URLSearchParams({
      client_id: 'alga-app',
      redirect_uri: 'http://localhost/qbo/callback',
      state: 'csrf',
    }).toString();
    const redirect = await fetch(authorize, { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    const callback = new URL(redirect.headers.get('location')!);
    expect(callback.searchParams.get('realmId')).toBe('realm-sim');
    const code = callback.searchParams.get('code')!;

    const basic = Buffer.from('alga-app:alga-secret').toString('base64');
    const exchanged = await fetch(`${base}/oauth2/v1/tokens/bearer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost/qbo/callback' }),
    });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json();
    expect(tokens.x_refresh_token_expires_in).toBeGreaterThan(0);

    const refreshed = await fetch(`${base}/oauth2/v1/tokens/bearer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    expect(refreshed.status).toBe(200);
    const rotated = await refreshed.json();
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    const reuse = await fetch(`${base}/oauth2/v1/tokens/bearer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    expect(reuse.status).toBe(400);

    accessToken = rotated.access_token;
    refreshToken = rotated.refresh_token;
    authed = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  });

  it('speaks the v3 entity protocol with QBO semantics', async () => {
    const created = await fetch(api('/customer'), {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ DisplayName: 'Acme Rockets' }),
    });
    expect(created.status).toBe(200);
    const customer = ((await created.json()) as any).Customer;
    expect(customer.SyncToken).toBe('0');

    const duplicate = await fetch(api('/customer'), {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ DisplayName: 'Acme Rockets' }),
    });
    expect(duplicate.status).toBe(400);
    expect(((await duplicate.json()) as any).Fault.Error[0].code).toBe('6240');

    const query = encodeURIComponent(
      "SELECT Id, DisplayName, SyncToken, PrimaryEmailAddr FROM Customer WHERE DisplayName = 'Acme Rockets'",
    );
    const queried = (await (await fetch(api(`/query?query=${query}`), { headers: authed })).json()) as any;
    expect(queried.QueryResponse.Customer[0].Id).toBe(customer.Id);

    const invoiceResponse = await fetch(api('/invoice'), {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({
        CustomerRef: { value: customer.Id },
        TotalAmt: 999999,
        Line: [
          { DetailType: 'SalesItemLineDetail', Amount: 150, SalesItemLineDetail: { ItemRef: { value: 'svc' } } },
          { DetailType: 'SalesItemLineDetail', Amount: 50, SalesItemLineDetail: { ItemRef: { value: 'svc' } } },
        ],
      }),
    });
    const invoice = ((await invoiceResponse.json()) as any).Invoice;
    expect(invoice.TotalAmt).toBe(200);
    expect(invoice.Balance).toBe(200);

    const payment = await controlPost('/control/qbo/actions/receive-payment', {
      invoiceId: invoice.Id,
      amountCents: 5_000,
    });
    expect(payment.ok).toBe(true);

    const read = (await (await fetch(api(`/invoice/${invoice.Id}`), { headers: authed })).json()) as any;
    expect(read.Invoice.Balance).toBe(150);
    expect(read.Invoice.SyncToken).toBe('1');

    const stale = await fetch(api('/invoice?operation=update'), {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ Id: invoice.Id, SyncToken: '0', PrivateNote: 'stale write' }),
    });
    expect(stale.status).toBe(400);
    expect(((await stale.json()) as any).Fault.Error[0].code).toBe('5010');

    const voided = await fetch(api('/invoice?operation=void'), {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ Id: invoice.Id, SyncToken: read.Invoice.SyncToken }),
    });
    expect(voided.status).toBe(200);
    expect(((await voided.json()) as any).Invoice.TotalAmt).toBe(0);

    const missing = await fetch(api('/invoice/nope'), { headers: authed });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as any).Fault.Error[0].code).toBe('610');
  });

  it('serves preferences, companyinfo, and the CDC envelope', async () => {
    const prefs = (await (
      await fetch(api(`/query?query=${encodeURIComponent('SELECT * FROM Preferences')}`), { headers: authed })
    ).json()) as any;
    expect(prefs.QueryResponse.Preferences[0].SalesFormsPrefs.AutoApplyCredit).toBe(false);

    await controlPost('/control/qbo/actions/configure', { autoApplyCredits: true });
    const toggled = (await (
      await fetch(api(`/query?query=${encodeURIComponent('SELECT * FROM Preferences')}`), { headers: authed })
    ).json()) as any;
    expect(toggled.QueryResponse.Preferences[0].SalesFormsPrefs.AutoApplyCredit).toBe(true);
    await controlPost('/control/qbo/actions/configure', { autoApplyCredits: false });

    const companyInfo = (await (await fetch(api('/companyinfo/realm-sim'), { headers: authed })).json()) as any;
    expect(companyInfo.CompanyInfo.Id).toBe('realm-sim');

    const seededCm = await controlPost('/control/qbo/seed/credit-memo', {
      customerId: (await controlPost('/control/qbo/seed/customer', { name: 'CDC Co' })).result.Id,
      amountCents: 1_000,
    });
    const cdc = (await (
      await fetch(api(`/cdc?entities=Customer,Invoice,CreditMemo,Payment&changedSince=${new Date(0).toISOString()}`), {
        headers: authed,
      })
    ).json()) as any;
    const grouped = cdc.CDCResponse[0].QueryResponse[0];
    expect(grouped.Customer.length).toBeGreaterThan(0);
    expect(grouped.CreditMemo.map((row: any) => row.Id)).toContain(seededCm.result.Id);
  });

  it('rejects wrong realms and expired tokens (and refresh recovers)', async () => {
    const wrongRealm = await fetch(`${base}/v3/company/other-realm/customer/1`, { headers: authed });
    expect(wrongRealm.status).toBe(403);

    await controlPost('/control/clock/advance', { duration: '2h' });
    const expired = await fetch(api('/companyinfo/realm-sim'), { headers: authed });
    expect(expired.status).toBe(401);

    const basic = Buffer.from('alga-app:alga-secret').toString('base64');
    const refreshed = await fetch(`${base}/oauth2/v1/tokens/bearer`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    expect(refreshed.status).toBe(200);
    const tokens = await refreshed.json();
    const recovered = await fetch(api('/companyinfo/realm-sim'), {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(recovered.status).toBe(200);
  });

  it('mints tokens directly for harness wiring', async () => {
    const minted = await controlPost('/control/qbo/actions/mint-tokens', { clientId: 'alga-app' });
    expect(minted.ok).toBe(true);
    expect(minted.result.realmId).toBe('realm-sim');
    const ok = await fetch(api('/companyinfo/realm-sim'), {
      headers: { authorization: `Bearer ${minted.result.access_token}` },
    });
    expect(ok.status).toBe(200);
  });
});
