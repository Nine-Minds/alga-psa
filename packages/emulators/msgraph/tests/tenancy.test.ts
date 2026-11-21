import { decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraphEmulator, {
  authorizeOverHttp, exchangeCodeOverHttp, registerTenantedClient, setSignedInUser, tokenOverHttp,
} from '../src/index';

const NINEMINDS = '99999999-9999-4999-8999-999999999999';
const CUSTOMER = 'bbbbbbbb-1111-4111-8111-111111111111';
const OTHER = 'cccccccc-2222-4222-8222-cccccccccccc';
const REDIRECT = 'http://localhost:3000/api/auth/callback/azure-ad';
const PLATFORM = { clientId: 'platform-app', clientSecret: 'platform-secret' };
const CUSTOMER_APP = { clientId: 'customer-app', clientSecret: 'customer-secret' };

let host: EmulatorHost;
let control: string;
let login: string;

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  control = `http://127.0.0.1:${started.controlPort}`;
  login = `http://127.0.0.1:${started.ports.msgraph}`;
  await registerTenantedClient(control, {
    ...PLATFORM, displayName: 'Nine Minds Platform', signInAudience: 'AzureADMultipleOrgs',
    homeTenantId: NINEMINDS, redirectUris: [REDIRECT],
  });
  await registerTenantedClient(control, {
    ...CUSTOMER_APP, displayName: 'Cedar Mail', signInAudience: 'AzureADMyOrg',
    homeTenantId: CUSTOMER, redirectUris: [REDIRECT],
  });
  await registerTenantedClient(control, { clientId: 'legacy-app', clientSecret: 'legacy-secret' });
  await setSignedInUser(control, { userPrincipalName: 'jamie@cedar.example', mail: 'jamie@cedar.example', tenantId: CUSTOMER });
});

afterAll(async () => {
  await host.stop();
});

const authorize = (authority: string, app = CUSTOMER_APP, redirectUri = REDIRECT) =>
  authorizeOverHttp(login, authority, { clientId: app.clientId, redirectUri, scope: 'Mail.Read offline_access', state: 'st-1' });

const claims = (token: string) => decodeJwt(token) as { tid: string; iss: string };

describe('AADSTS50011 redirect URI mismatch', () => {
  it('renders a hosted 400 page with no redirect', async () => {
    const bad = 'https://evil.example/cb';
    const response = await fetch(
      `${login}/common/oauth2/v2.0/authorize?client_id=customer-app&redirect_uri=${encodeURIComponent(bad)}`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('AADSTS50011');
    expect(html).toContain(`The redirect URI &#39;${bad}&#39; specified in the request does not match`);
    expect(html).toContain("aka.ms/redirectUriMismatchError");
  });

  it('accepts any redirect URI for an app without a registered list', async () => {
    const result = await authorize('common', { clientId: 'legacy-app', clientSecret: 'legacy-secret' }, 'http://anything.example/cb');
    expect(result.code).toBeTruthy();
  });
});

describe('single-tenant app (customer)', () => {
  it('AADSTS50194 at /authorize for /common and /organizations, state echoed', async () => {
    for (const authority of ['common', 'organizations']) {
      const result = await authorize(authority);
      expect(result.status).toBe(302);
      expect(result.code).toBeUndefined();
      expect(result.state).toBe('st-1');
      expect(result.error).toBe('invalid_request');
      expect(result.errorDescription).toContain(
        "AADSTS50194: Application 'customer-app'(Cedar Mail) isn't configured as a multitenant application. Usage of the /common endpoint isn't supported for such applications created after '",
      );
      expect(result.errorDescription).toContain('Use a tenant-specific endpoint or configure the application to be multitenant.');
    }
  });

  it('AADSTS50194 at /token for both grants', async () => {
    const granted = await authorize(CUSTOMER);
    expect(granted.code).toBeTruthy();
    const code = await exchangeCodeOverHttp(login, 'common', { ...CUSTOMER_APP, code: granted.code!, redirectUri: REDIRECT });
    expect(code.status).toBe(400);
    expect(code.body).toMatchObject({ error: 'invalid_request', error_codes: [50194] });
    expect(code.body.error_description).toContain('AADSTS50194');
    for (const field of ['timestamp', 'trace_id', 'correlation_id']) expect(code.body[field]).toBeTruthy();

    // The failed exchange did not consume the code: the right authority still works.
    const ok = await exchangeCodeOverHttp(login, CUSTOMER, { ...CUSTOMER_APP, code: granted.code!, redirectUri: REDIRECT });
    expect(ok.status).toBe(200);
    const refresh = await tokenOverHttp(login, 'organizations', {
      grant_type: 'refresh_token', client_id: 'customer-app', client_secret: 'customer-secret', refresh_token: ok.body.refresh_token,
    });
    expect(refresh.status).toBe(400);
    expect(refresh.body).toMatchObject({ error: 'invalid_request', error_codes: [50194] });
  });

  it('own tenant authority works; tid/iss are the home tenant on code and refresh', async () => {
    const granted = await authorize(CUSTOMER);
    expect(granted.status).toBe(302);
    const tokens = await exchangeCodeOverHttp(login, CUSTOMER, { ...CUSTOMER_APP, code: granted.code!, redirectUri: REDIRECT });
    expect(tokens.status).toBe(200);
    expect(claims(tokens.body.access_token)).toMatchObject({
      tid: CUSTOMER, iss: `https://login.microsoftonline.com/${CUSTOMER}/v2.0`,
    });
    const refreshed = await tokenOverHttp(login, CUSTOMER, {
      grant_type: 'refresh_token', client_id: 'customer-app', client_secret: 'customer-secret', refresh_token: tokens.body.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    expect(claims(refreshed.body.access_token).tid).toBe(CUSTOMER);
  });

  it('AADSTS700016 for another tenant authority at /authorize and /token', async () => {
    const result = await authorize(OTHER);
    expect(result.status).toBe(400);
    expect(result.location).toBeUndefined();
    expect(result.html).toContain(`AADSTS700016: Application with identifier &#39;customer-app&#39; was not found in the directory &#39;${OTHER}&#39;`);
    expect(result.html).toContain('You may have sent your authentication request to the wrong tenant.');

    const granted = await authorize(CUSTOMER);
    const token = await exchangeCodeOverHttp(login, OTHER, { ...CUSTOMER_APP, code: granted.code!, redirectUri: REDIRECT });
    expect(token.status).toBe(400);
    expect(token.body).toMatchObject({ error: 'unauthorized_client', error_codes: [700016] });
  });

  it('AADSTS50020 when the signed-in user is from another directory', async () => {
    await setSignedInUser(control, { userPrincipalName: 'guest@other.example', tenantId: OTHER });
    try {
      const result = await authorize(CUSTOMER);
      expect(result.status).toBe(400);
      expect(result.location).toBeUndefined();
      expect(result.html).toContain('AADSTS50020');
      expect(result.html).toContain(`User account &#39;guest@other.example&#39; from identity provider &#39;https://sts.windows.net/${OTHER}/&#39; does not exist in tenant &#39;${CUSTOMER}&#39; and cannot access the application &#39;customer-app&#39;(Cedar Mail) in that tenant.`);
    } finally {
      await setSignedInUser(control, { userPrincipalName: 'jamie@cedar.example', tenantId: CUSTOMER });
    }
  });
});

describe('multi-tenant platform app', () => {
  it('/common and /organizations work; tid/iss are the signed-in user tenant, not the home tenant', async () => {
    for (const authority of ['common', 'organizations']) {
      const granted = await authorize(authority, PLATFORM);
      expect(granted.code).toBeTruthy();
      const tokens = await exchangeCodeOverHttp(login, authority, { ...PLATFORM, code: granted.code!, redirectUri: REDIRECT });
      expect(tokens.status).toBe(200);
      expect(claims(tokens.body.access_token)).toMatchObject({
        tid: CUSTOMER, iss: `https://login.microsoftonline.com/${CUSTOMER}/v2.0`,
      });
      const refreshed = await tokenOverHttp(login, authority, {
        grant_type: 'refresh_token', client_id: PLATFORM.clientId, client_secret: PLATFORM.clientSecret,
        refresh_token: tokens.body.refresh_token,
      });
      expect(claims(refreshed.body.access_token).tid).toBe(CUSTOMER);
    }
  });

  it('authority pinned to the vendor tenant for a customer user is AADSTS50020 (Nov 2025 regression)', async () => {
    const result = await authorize(NINEMINDS, PLATFORM);
    expect(result.status).toBe(400);
    expect(result.location).toBeUndefined();
    expect(result.html).toContain('AADSTS50020');
    expect(result.html).toContain(`from identity provider &#39;https://sts.windows.net/${CUSTOMER}/&#39; does not exist in tenant &#39;${NINEMINDS}&#39;`);

    const granted = await authorize('common', PLATFORM);
    const token = await exchangeCodeOverHttp(login, NINEMINDS, { ...PLATFORM, code: granted.code!, redirectUri: REDIRECT });
    expect(token.status).toBe(400);
    expect(token.body).toMatchObject({ error: 'invalid_grant', error_codes: [50020] });
  });

  it("the user's own tenant authority is fine", async () => {
    expect((await authorize(CUSTOMER, PLATFORM)).code).toBeTruthy();
  });
});

describe('legacy clients', () => {
  it('keep the emulated tenant on /common', async () => {
    await setSignedInUser(control, { tenantId: '' });
    try {
      const granted = await authorize('common', { clientId: 'legacy-app', clientSecret: 'legacy-secret' });
      const tokens = await exchangeCodeOverHttp(login, 'common', { clientId: 'legacy-app', clientSecret: 'legacy-secret', code: granted.code!, redirectUri: REDIRECT });
      expect(claims(tokens.body.access_token).tid).toBe('11111111-2222-4333-8444-555555555555');
    } finally {
      await setSignedInUser(control, { tenantId: CUSTOMER });
    }
  });
});
