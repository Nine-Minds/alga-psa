import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dependencyRoot = process.env.NATIVE_MICROSOFT_OIDC_PLAYWRIGHT_ROOT || fileURLToPath(new URL('../../../e2e-tests/', import.meta.url));
const require = createRequire(path.join(dependencyRoot, 'package.json'));
const { request } = require('@playwright/test');

// The caller owns the isolated application, authority and database lifecycle.
// No provider, profile mapping, account-link callback or session code is mocked.
export async function checkMicrosoftCallback({ origin, authority, fixture, db }) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  const links = () => db('user_auth_accounts').where({ tenant: fixture.tenant, user_id: fixture.userId }).orderBy('provider_account_id');
  let before = await links();
  assert.equal(before.length, 0, 'Use a new unlinked synthetic identity');
  const tokenRequests = () => authority.requests.filter(r => r.method === 'POST' && r.path.endsWith('/token')).length;
  async function attempt(validState) {
    const context = await request.newContext({ baseURL: origin });
    try {
      const csrf = await (await context.get('/api/auth/csrf', { timeout: 60000 })).json();
      const signin = await context.post('/api/auth/signin/azure-ad', { timeout: 60000, maxRedirects: 0,
        headers: { 'X-Auth-Return-Redirect': '1' }, form: { csrfToken: csrf.csrfToken, callbackUrl: `${origin}/msp/dashboard` } });
      const payload = await signin.json();
      const grant = authority.issueCode(payload.url, origin);
      const beforeTokens = tokenRequests();
      const callback = await context.get(`/api/auth/callback/azure-ad?${new URLSearchParams({ code: grant.code,
        state: validState ? grant.state : 'invalid-state' })}`, { timeout: 60000, maxRedirects: 0 });
      assert.ok([302, 303].includes(callback.status()));
      const session = await (await context.get('/api/auth/session', { timeout: 60000 })).json();
      if (!validState) {
        assert.equal(session.user, undefined);
        assert.equal(tokenRequests(), beforeTokens, 'State must be rejected before token exchange');
        assert.deepEqual(await links(), before);
      } else {
        assert.equal(new URL(callback.headers().location, origin).pathname, '/msp/dashboard');
        assert.equal(session.user.id, fixture.userId);
        assert.equal(session.user.tenant, fixture.tenant);
        assert.equal(session.user.email, fixture.email);
        const stored = await links();
        assert.equal(stored.length, 1);
        assert.equal(stored[0].provider, 'microsoft');
        assert.equal(stored[0].provider_account_id, fixture.providerObjectId);
        assert.equal(stored[0].provider_email, fixture.email);
        assert.equal(tokenRequests(), beforeTokens + 1);
      }
      return { stateAccepted: validState, nonceRequested: grant.nonceRequested };
    } finally { await context.dispose(); }
  }
  const accepted = await attempt(true);
  before = await links();
  const rejected = await attempt(false);
  return { status: 'passed', rejected, accepted, tokenRequests: tokenRequests(),
    jwksRequests: authority.requests.filter(r => r.path?.endsWith('/keys')).length,
    limitations: ['Synthetic authority replaces transport only; no live Microsoft consent proof.',
      'Only configured checks are exercised; reported nonce/JWKS use must not be inferred.'] };
}
