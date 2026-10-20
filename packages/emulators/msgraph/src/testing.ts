/**
 * Helpers for tests in OTHER packages that need to reproduce Microsoft
 * identity-platform tenancy failures over plain HTTP.
 *
 * Typical use (server-side emulator-backed test):
 *
 *   const host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
 *   const { controlPort, ports } = await host.start();
 *   const control = `http://127.0.0.1:${controlPort}`, login = `http://127.0.0.1:${ports.msgraph}`;
 *   await registerTenantedClient(control, {
 *     clientId, clientSecret, signInAudience: 'AzureADMyOrg', homeTenantId: customerTenant,
 *     redirectUris: [callbackUrl],
 *   });
 *   await setSignedInUser(control, { userPrincipalName: 'jamie@cedar.example', tenantId: customerTenant });
 *   const result = await authorizeOverHttp(login, customerTenant, { clientId, redirectUri: callbackUrl, scope, state });
 *   // result.code on success; result.error / result.errorDescription for 50194;
 *   // result.html (HTTP 400, no Location) for 50011 / 700016 / 50020.
 *   const tokens = await exchangeCodeOverHttp(login, customerTenant, { clientId, clientSecret, code: result.code!, redirectUri: callbackUrl });
 *
 * Point MICROSOFT_LOGIN_BASE_URL at `login`.
 */
import type { ClientTenancyOptions, SignedInUser } from './core';

async function controlPost(control: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { result?: unknown; error?: unknown };
  if (!response.ok) throw new Error(`emulator control ${path} failed: ${JSON.stringify(json)}`);
  return json.result;
}

export function registerTenantedClient(
  control: string,
  client: ClientTenancyOptions & { clientId: string; clientSecret: string; appRoles?: string[] },
): Promise<unknown> {
  return controlPost(control, '/control/msgraph/seed/client', client);
}

export function setSignedInUser(control: string, user: Partial<SignedInUser>): Promise<unknown> {
  return controlPost(control, '/control/msgraph/seed/signed-in-user', user);
}

export interface AuthorizeOutcome {
  status: number;
  /** Raw Location header, absent for the hosted error page. */
  location?: string;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  /** Hosted error page body (AADSTS50011 / 700016 / 50020). */
  html?: string;
}

/** Drives GET /{authority}/oauth2/v2.0/authorize with redirect: 'manual'. */
export async function authorizeOverHttp(
  login: string,
  authority: string,
  input: { clientId: string; redirectUri: string; scope?: string; state?: string; nonce?: string },
): Promise<AuthorizeOutcome> {
  const url = new URL(`${login}/${encodeURIComponent(authority)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  for (const key of ['scope', 'state', 'nonce'] as const) {
    if (input[key]) url.searchParams.set(key, input[key]!);
  }
  const response = await fetch(url, { redirect: 'manual' });
  const location = response.headers.get('location') ?? undefined;
  if (!location) return { status: response.status, html: await response.text() };
  const params = new URL(location).searchParams;
  return {
    status: response.status,
    location,
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
    errorDescription: params.get('error_description') ?? undefined,
  };
}

/** POSTs the token endpoint; returns the HTTP status and parsed JSON body. */
export async function tokenOverHttp(
  login: string,
  authority: string,
  form: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${login}/${encodeURIComponent(authority)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  return { status: response.status, body: await response.json() };
}

export function exchangeCodeOverHttp(
  login: string,
  authority: string,
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
) {
  return tokenOverHttp(login, authority, {
    grant_type: 'authorization_code', client_id: input.clientId, client_secret: input.clientSecret,
    code: input.code, redirect_uri: input.redirectUri,
  });
}
