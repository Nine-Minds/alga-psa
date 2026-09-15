import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

// This is an OIDC contract fixture, not Microsoft consent or a live Entra tenant.
export async function startMicrosoftOidcAuthority(fixture) {
  const issuer = `https://login.microsoftonline.com/${fixture.microsoftTenantId}/v2.0`;
  const prefix = `/${fixture.microsoftTenantId}`;
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'native-callback-key', alg: 'RS256', use: 'sig' };
  const grants = new Map();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, path: req.url });
    const check = (condition, reason) => { if (!condition) { const error = new Error('Fixture grant rejected'); error.reason = reason; throw error; } };
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && req.url === `${prefix}/v2.0/.well-known/openid-configuration`) {
        return reply(200, { issuer, authorization_endpoint: `https://login.microsoftonline.com${prefix}/oauth2/v2.0/authorize`,
          token_endpoint: `https://login.microsoftonline.com${prefix}/oauth2/v2.0/token`,
          jwks_uri: `https://login.microsoftonline.com${prefix}/discovery/v2.0/keys`,
          userinfo_endpoint: `https://login.microsoftonline.com${prefix}/userinfo`,
          response_types_supported: ['code'], subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
          code_challenge_methods_supported: ['S256'] });
      }
      if (req.method === 'GET' && req.url === `${prefix}/userinfo`) return reply(200, { sub: 'pairwise-subject-distinct-from-oid', oid: fixture.providerObjectId, tid: fixture.microsoftTenantId, email: fixture.email, name: 'Native Microsoft callback' });
      if (req.method === 'GET' && req.url === `${prefix}/discovery/v2.0/keys`) return reply(200, { keys: [key] });
      if (req.method === 'POST' && req.url === `${prefix}/oauth2/v2.0/token`) {
        let body = ''; for await (const chunk of req) { body += chunk; assert.ok(body.length < 16384); }
        const form = new URLSearchParams(body), grant = grants.get(form.get('code'));
        check(Boolean(grant), 'unknown-code');
        grants.delete(form.get('code'));
        check(form.get('grant_type') === 'authorization_code', 'grant-type');
        const basic = req.headers.authorization?.startsWith('Basic ')
          ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':').map(decodeURIComponent) : null;
        check((basic?.[0] ?? form.get('client_id')) === fixture.clientId, 'client-id');
        check((basic?.[1] ?? form.get('client_secret')) === fixture.clientSecret, 'client-secret');
        check(form.get('redirect_uri') === grant.redirectUri, 'redirect-uri');
        check(createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') === grant.challenge, 'pkce');
        const token = await new SignJWT({ oid: fixture.providerObjectId, tid: fixture.microsoftTenantId,
          email: fixture.email, preferred_username: fixture.email, name: 'Native Microsoft callback',
          ...(grant.nonce ? { nonce: grant.nonce } : {}) })
          .setProtectedHeader({ alg: 'RS256', kid: key.kid }).setIssuer(issuer).setAudience(fixture.clientId)
          .setSubject('pairwise-subject-distinct-from-oid').setIssuedAt().setExpirationTime('5m').sign(privateKey);
        return reply(200, { token_type: 'Bearer', expires_in: 300, access_token: 'synthetic-access', id_token: token, scope: 'openid profile email User.Read' });
      }
      reply(404, { error: 'unsupported_fixture_route' });
    } catch (error) { requests.push({ validationError: error.reason || 'invalid-request' }); reply(400, { error: 'invalid_grant' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`, issuer, requests,
    issueCode(authorizationUrl, expectedOrigin) {
      const url = new URL(authorizationUrl);
      assert.equal(url.origin, 'https://login.microsoftonline.com');
      assert.equal(url.pathname, `${prefix}/oauth2/v2.0/authorize`);
      assert.equal(url.searchParams.get('client_id'), fixture.clientId);
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.get('state'));
      const redirectUri = url.searchParams.get('redirect_uri');
      try { assert.equal(redirectUri, `${expectedOrigin}/api/auth/callback/azure-ad`); }
      catch (error) {
        const actual = new URL(redirectUri);
        error.redirectMismatch = { actualOrigin: actual.origin, actualPath: actual.pathname, expectedOrigin };
        throw error;
      }
      const code = randomUUID();
      grants.set(code, { redirectUri, challenge: url.searchParams.get('code_challenge'), nonce: url.searchParams.get('nonce') });
      return { code, state: url.searchParams.get('state'), nonceRequested: url.searchParams.has('nonce') };
    },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
