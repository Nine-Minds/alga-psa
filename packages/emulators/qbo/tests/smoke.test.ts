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

  // The customer bug: an Automated Sales Tax company carries a large,
  // auto-generated tax-code table, so the mapping catalog was truncated at
  // QBO's 100-row default and any code past it printed its bare backend Id.
  // This drives the whole readable-label + paging + AST path over the wire.
  it('serves a large AST tax-code catalog with readable labels, pages past 100, and computes AST tax', async () => {
    // Self-contained: own client + freshly minted token, so this test does not
    // depend on the OAuth test's ordering or the clock advances later tests make.
    await controlPost('/control/qbo/seed/client', { clientId: 'tax-app', clientSecret: 'tax-secret' });
    const minted = (await controlPost('/control/qbo/actions/mint-tokens', { clientId: 'tax-app' })).result;
    const taxAuthed = { authorization: `Bearer ${minted.access_token}`, 'content-type': 'application/json' };

    // A real California jurisdiction group: three rate components summing to 9%.
    await controlPost('/control/qbo/seed/tax-rate', { id: 'r-state', name: 'CA State', ratePercent: 6.25 });
    await controlPost('/control/qbo/seed/tax-rate', { id: 'r-county', name: 'Santa Clara County', ratePercent: 1 });
    await controlPost('/control/qbo/seed/tax-rate', { id: 'r-district', name: 'SC District', ratePercent: 1.75 });
    await controlPost('/control/qbo/seed/tax-code', {
      id: 'CA-GROUP',
      name: 'California Sales Tax',
      description: 'CA state + Santa Clara county + district',
      taxRateIds: ['r-state', 'r-county', 'r-district'],
    });

    // The auto-generated bulk an AST file carries: 120 codes push the catalog
    // well past the 100-row page the old single-shot query stopped at.
    for (let index = 1; index <= 120; index += 1) {
      await controlPost('/control/qbo/seed/tax-code', {
        id: `AUTO-${index}`,
        name: `Auto-generated Tax ${index}`,
        taxRateIds: ['r-state'],
      });
    }
    // The pseudo codes that only exist under AST, returned with no Active field.
    await controlPost('/control/qbo/seed/tax-code', { id: 'TAX', name: 'TAX', pseudo: true });
    await controlPost('/control/qbo/seed/tax-code', { id: 'NON', name: 'NON', pseudo: true });

    // --- Fix (a): paging + readable labels, exactly as the mapping UI reads them.
    const pageQuery = (start: number, max: number) =>
      encodeURIComponent(`SELECT * FROM TaxCode STARTPOSITION ${start} MAXRESULTS ${max}`);
    const firstPage = (await (await fetch(api(`/query?query=${pageQuery(1, 100)}`), { headers: taxAuthed })).json()) as any;
    const secondPage = (await (await fetch(api(`/query?query=${pageQuery(101, 100)}`), { headers: taxAuthed })).json()) as any;
    const page1 = firstPage.QueryResponse.TaxCode as any[];
    const page2 = secondPage.QueryResponse.TaxCode as any[];
    // The 100-row default would have hidden 23 codes; paging recovers every one.
    expect(page1).toHaveLength(100);
    expect(page2).toHaveLength(23);

    const all = [...page1, ...page2];
    // No row is a bare Id — every code carries a human-readable Name.
    for (const code of all) {
      expect(typeof code.Name).toBe('string');
      expect(code.Name.length).toBeGreaterThan(0);
    }
    const group = all.find((code) => code.Id === 'CA-GROUP');
    expect(group.Name).toBe('California Sales Tax');
    expect(group.Description).toContain('Santa Clara');
    // The rate components (what enrichment turns into "9%") ride under the group.
    expect(group.SalesTaxRateList.TaxRateDetail).toHaveLength(3);
    // TAX/NON pseudo codes land on the far page; Intuit omits Active on them.
    const pseudo = all.find((code) => code.Id === 'TAX');
    expect(pseudo.Name).toBe('TAX');
    expect(pseudo.Active).toBeUndefined();

    // --- Fix (b): under AST, a TAX-marked line is taxed at the resolved rate.
    await controlPost('/control/qbo/actions/configure', { automatedSalesTaxDefaultTaxCodeId: 'CA-GROUP' });
    const astCustomer = (await controlPost('/control/qbo/seed/customer', { name: 'AST Buyer' })).result;

    const taxedResp = await fetch(api('/invoice'), {
      method: 'POST',
      headers: taxAuthed,
      body: JSON.stringify({
        CustomerRef: { value: astCustomer.Id },
        Line: [
          {
            DetailType: 'SalesItemLineDetail',
            Amount: 200,
            SalesItemLineDetail: { ItemRef: { value: 'svc' }, TaxCodeRef: { value: 'TAX' } },
          },
        ],
      }),
    });
    const taxed = ((await taxedResp.json()) as any).Invoice;
    // 200 * (6.25 + 1 + 1.75)% = 18, split across the three jurisdiction lines.
    expect(taxed.TxnTaxDetail.TotalTax).toBe(18);
    expect(taxed.TxnTaxDetail.TaxLine.map((line: any) => line.Amount)).toEqual([12.5, 2, 3.5]);
    expect(taxed.TotalAmt).toBe(218);

    // A NON-marked line is exempt even while AST is on.
    const exemptResp = await fetch(api('/invoice'), {
      method: 'POST',
      headers: taxAuthed,
      body: JSON.stringify({
        CustomerRef: { value: astCustomer.Id },
        Line: [
          {
            DetailType: 'SalesItemLineDetail',
            Amount: 200,
            SalesItemLineDetail: { ItemRef: { value: 'svc' }, TaxCodeRef: { value: 'NON' } },
          },
        ],
      }),
    });
    expect(((await exemptResp.json()) as any).Invoice.TxnTaxDetail.TotalTax).toBe(0);

    // --- Turning AST off returns to a plain file: invoices carry no tax detail.
    await controlPost('/control/qbo/actions/configure', { automatedSalesTaxDefaultTaxCodeId: null });
    const plainResp = await fetch(api('/invoice'), {
      method: 'POST',
      headers: taxAuthed,
      body: JSON.stringify({
        CustomerRef: { value: astCustomer.Id },
        Line: [{ DetailType: 'SalesItemLineDetail', Amount: 200, SalesItemLineDetail: { ItemRef: { value: 'svc' } } }],
      }),
    });
    const plain = ((await plainResp.json()) as any).Invoice;
    expect(plain.TxnTaxDetail).toBeUndefined();
    expect(plain.TotalAmt).toBe(200);

    // The augmentation's state views expose the seeded catalog to the harness.
    const stateCodes = (await (await fetch(`${control}/control/qbo/state/tax-codes`)).json()) as any;
    expect(stateCodes.result.length).toBe(123);
    const stateRates = (await (await fetch(`${control}/control/qbo/state/tax-rates`)).json()) as any;
    expect(stateRates.result.map((rate: any) => rate.Id)).toContain('r-district');

    // Leave AST off so later tests see a clean company file.
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
