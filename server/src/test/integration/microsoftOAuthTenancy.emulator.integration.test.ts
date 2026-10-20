import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph, {
  authorizeOverHttp,
  exchangeCodeOverHttp,
  registerTenantedClient,
  setSignedInUser,
} from '@alga-psa/emulator-msgraph';
import {
  MICROSOFT_MULTI_TENANT_AUTHORITY,
  resolveMicrosoftOAuthAuthority,
} from '@alga-psa/shared/services/email/microsoftAuthority';
import {
  MICROSOFT_OAUTH_FAILURE_ERROR_CODES,
  classifyMicrosoftOAuthFailure,
  describeMicrosoftOAuthFailureForMailboxFlow,
} from '@alga-psa/shared/services/email/microsoftOAuthErrors';
import {
  buildMicrosoftEmailRedirectUri,
} from '@alga-psa/shared/services/email/microsoftRedirectUris';
import { computeEntraCallbackUrl } from '@alga-psa/shared/services/entra/entraCallbackUrl';
import { buildEntraCallbackErrorKey } from '@ee/components/settings/integrations/entra/entraCallbackErrors';

/**
 * A single-tenant Azure app (the Neo Hosting / alga0002272 shape) driven
 * through the msgraph emulator's authority enforcement, using the same
 * authority resolver and error mappers the email and Entra callbacks use.
 *
 * The routes themselves are covered by unit tests; this pins the behaviour
 * the fix depends on: tenant-owned issuers must hit their tenant authority,
 * and /common must produce the specific, mapped message instead of a generic
 * failure.
 */

const CUSTOMER_TENANT = '5b7c1d0e-1111-4222-8333-944455556666';
const CLIENT_ID = 'single-tenant-app';
const CLIENT_SECRET = 'single-tenant-secret';
const BASE_URL = 'https://psa.example.test';
const EMAIL_REDIRECT = buildMicrosoftEmailRedirectUri(BASE_URL);
const ENTRA_REDIRECT = computeEntraCallbackUrl(BASE_URL);
const SCOPE = 'openid offline_access https://graph.microsoft.com/Mail.Read';

let host: EmulatorHost;
let login: string;

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  const control = `http://127.0.0.1:${started.controlPort}`;
  login = `http://127.0.0.1:${started.ports.msgraph}`;
  await registerTenantedClient(control, {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    signInAudience: 'AzureADMyOrg',
    homeTenantId: CUSTOMER_TENANT,
    redirectUris: [EMAIL_REDIRECT, ENTRA_REDIRECT],
  });
  await setSignedInUser(control, { userPrincipalName: 'jamie@cedar.example', tenantId: CUSTOMER_TENANT });
});

afterAll(async () => {
  await host?.stop();
});

describe('email connect with a single-tenant app', () => {
  it('succeeds at the tenant authority the resolver picks for a tenant-owned issuer', async () => {
    const authority = resolveMicrosoftOAuthAuthority({
      issuerKind: 'tenant-owned',
      profileTenantId: CUSTOMER_TENANT,
    });
    expect(authority).toBe(CUSTOMER_TENANT);

    const authorized = await authorizeOverHttp(login, authority, {
      clientId: CLIENT_ID,
      redirectUri: EMAIL_REDIRECT,
      scope: SCOPE,
      state: 's1',
    });
    expect(authorized.code).toBeTruthy();

    const tokens = await exchangeCodeOverHttp(login, authority, {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: authorized.code!,
      redirectUri: EMAIL_REDIRECT,
    });
    expect(tokens.status).toBe(200);
    expect(tokens.body.access_token).toBeTruthy();
  });

  it('is rejected at /common with the mapped 50194 email message', async () => {
    const authorized = await authorizeOverHttp(login, MICROSOFT_MULTI_TENANT_AUTHORITY, {
      clientId: CLIENT_ID,
      redirectUri: EMAIL_REDIRECT,
      scope: SCOPE,
      state: 's2',
    });
    expect(authorized.code).toBeUndefined();
    expect(authorized.errorDescription).toContain('AADSTS50194');

    const kind = classifyMicrosoftOAuthFailure({
      error: authorized.error,
      errorDescription: authorized.errorDescription,
    });
    expect(kind).toBe('single_tenant_app');
    expect(describeMicrosoftOAuthFailureForMailboxFlow(kind!, { redirectUri: EMAIL_REDIRECT })).toMatch(
      /single-tenant/i
    );
  });

  it('never resolves a platform-managed issuer to the profile tenant', () => {
    expect(
      resolveMicrosoftOAuthAuthority({ issuerKind: 'platform-managed', profileTenantId: CUSTOMER_TENANT })
    ).toBe(MICROSOFT_MULTI_TENANT_AUTHORITY);
  });
});

describe('Entra connect with a single-tenant app', () => {
  it('gets the mapped "make it multi-tenant" message because Entra stays on /common', async () => {
    const authorized = await authorizeOverHttp(login, MICROSOFT_MULTI_TENANT_AUTHORITY, {
      clientId: CLIENT_ID,
      redirectUri: ENTRA_REDIRECT,
      scope: SCOPE,
      state: 's3',
    });
    expect(authorized.code).toBeUndefined();
    const kind = classifyMicrosoftOAuthFailure({
      error: authorized.error,
      errorDescription: authorized.errorDescription,
    });
    expect(kind).toBe('single_tenant_app');

    const uiCode = MICROSOFT_OAUTH_FAILURE_ERROR_CODES[kind!];
    const key = buildEntraCallbackErrorKey(uiCode);
    expect(key).toBe('integrations.entra.settings.connection.callbackErrors.singleTenantApp');
  });

  it('maps a 50194 rejection to the single-tenant Entra message key', () => {
    expect(buildEntraCallbackErrorKey(MICROSOFT_OAUTH_FAILURE_ERROR_CODES.single_tenant_app)).toBe(
      'integrations.entra.settings.connection.callbackErrors.singleTenantApp'
    );
  });
});
