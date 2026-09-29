import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { startMicrosoftOidcAuthority } from '../../packages/auth/test-harness/microsoft-oidc-authority.mjs';

const fixture = { microsoftTenantId: 'synthetic-tenant', providerObjectId: 'synthetic-object',
  clientId: 'synthetic-client', clientSecret: 'synthetic-secret', email: 'oidc@example.test' };
const origin = 'http://127.0.0.1:3000';
const verifier = 'a'.repeat(48);
const preload = fileURLToPath(new URL('../../packages/auth/test-harness/microsoft-oidc-preload.mjs', import.meta.url));
function authorization(authority, overrides = {}) {
  return `${authority.issuer.replace('/v2.0', '')}/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: fixture.clientId, response_type: 'code', state: 'synthetic-state', nonce: 'synthetic-nonce',
    redirect_uri: `${origin}/api/auth/callback/azure-ad`, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), ...overrides,
  })}`;
}
async function exchange(authority, code, overrides = {}, basic = false) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: fixture.clientId,
    client_secret: fixture.clientSecret, redirect_uri: `${origin}/api/auth/callback/azure-ad`, code_verifier: verifier, ...overrides });
  const headers = {};
  if (basic) { body.delete('client_id'); body.delete('client_secret'); headers.authorization = `Basic ${Buffer.from(`${fixture.clientId}:${fixture.clientSecret}`).toString('base64')}`; }
  return fetch(`${authority.baseUrl}/${fixture.microsoftTenantId}/oauth2/v2.0/token`, { method: 'POST', headers, body });
}
function child(authority, code, overrides = {}) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ['--import', preload, '--input-type=module', '-e', code], {
      env: { PATH: process.env.PATH, NODE_ENV: 'test', NATIVE_MICROSOFT_OIDC_ISOLATED: 'true',
        NATIVE_MICROSOFT_OIDC_AUTHORITY: authority, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => processChild.kill('SIGKILL'), 10_000);
    processChild.stdout.on('data', chunk => { stdout += chunk; });
    processChild.stderr.on('data', chunk => { stderr += chunk; });
    processChild.once('error', error => { clearTimeout(timer); reject(error); });
    processChild.once('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

for (const basic of [false, true]) test(`authority discovery and ${basic ? 'Basic' : 'POST'} PKCE exchange produce a verifiable single-use token`, async t => {
  const authority = await startMicrosoftOidcAuthority(fixture); t.after(() => authority.close());
  const discovery = await (await fetch(`${authority.baseUrl}/${fixture.microsoftTenantId}/v2.0/.well-known/openid-configuration`)).json();
  assert.equal(discovery.issuer, authority.issuer);
  assert.equal(new URL(discovery.token_endpoint).origin, 'https://login.microsoftonline.com');
  assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
  const grant = authority.issueCode(authorization(authority), origin);
  assert.equal(grant.state, 'synthetic-state'); assert.equal(grant.nonceRequested, true);
  const response = await exchange(authority, grant.code, {}, basic); assert.equal(response.status, 200);
  const tokens = await response.json();
  const jwks = await (await fetch(`${authority.baseUrl}/${fixture.microsoftTenantId}/discovery/v2.0/keys`)).json();
  const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), { issuer: discovery.issuer, audience: fixture.clientId, algorithms: ['RS256'] });
  assert.equal(payload.oid, fixture.providerObjectId); assert.notEqual(payload.sub, payload.oid);
  assert.equal(payload.email, fixture.email); assert.equal(payload.tid, fixture.microsoftTenantId);
  assert.equal(payload.nonce, 'synthetic-nonce'); assert.equal(payload.exp - payload.iat, 300);
  await assert.rejects(jwtVerify(tokens.id_token, createLocalJWKSet(jwks), { audience: 'wrong-client' }));
  await assert.rejects(jwtVerify(tokens.id_token, createLocalJWKSet(jwks), { issuer: 'https://wrong.example' }));
  const parts = tokens.id_token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...payload, oid: 'forged-object' })).toString('base64url');
  await assert.rejects(jwtVerify(parts.join('.'), createLocalJWKSet(jwks)), /signature verification failed/);
  assert.equal((await exchange(authority, grant.code)).status, 400);
  assert.equal((await exchange(authority, 'unknown-code')).status, 400);
});

for (const [name, change] of Object.entries({ pkce: { code_verifier: 'wrong' }, client: { client_secret: 'wrong' }, redirect: { redirect_uri: `${origin}/other` }, grant: { grant_type: 'refresh_token' } })) {
  test(`authority rejects invalid ${name} without issuing a token`, async t => {
    const authority = await startMicrosoftOidcAuthority(fixture); t.after(() => authority.close());
    const grant = authority.issueCode(authorization(authority), origin);
    const response = await exchange(authority, grant.code, change);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_grant' });
  });
}

test('authority requires the exact application callback redirect', async t => {
  const authority = await startMicrosoftOidcAuthority(fixture); t.after(() => authority.close());
  for (const redirect_uri of [`${origin}/other`, `${origin}/api/auth/callback/azure-ad?extra=1`, 'https://external.example/api/auth/callback/azure-ad']) {
    assert.throws(() => authority.issueCode(authorization(authority, { redirect_uri }), origin));
  }
});

for (const [name, target, env] of [
  ['production', 'http://127.0.0.1:1', { NODE_ENV: 'production' }],
  ['ungated', 'http://127.0.0.1:1', { NATIVE_MICROSOFT_OIDC_ISOLATED: 'false' }],
  ['nonloopback', 'http://example.test', {}], ['path', 'http://127.0.0.1:1/path', {}],
  ['query', 'http://127.0.0.1:1/?key=value', {}], ['hash', 'http://127.0.0.1:1/#hash', {}],
]) test(`preload refuses ${name} authority before application execution`, async () => {
  const result = await child(target, 'console.log("application-ran")', env);
  assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  assert.match(result.stderr, /requires an isolated loopback authority/);
});

test('preload redirects canonical Microsoft discovery over real loopback HTTP and refuses other external destinations', async t => {
  const authority = await startMicrosoftOidcAuthority(fixture); t.after(() => authority.close());
  const result = await child(authority.baseUrl, `const r=await fetch(${JSON.stringify(`${authority.issuer}/.well-known/openid-configuration`)}); console.log((await r.json()).issuer); await import('node:assert/strict').then(({default:a})=>a.rejects(fetch('https://example.test/'),/External network destination refused/));`);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), authority.issuer);
  assert.deepEqual(authority.requests, [{ method: 'GET', path: `/${fixture.microsoftTenantId}/v2.0/.well-known/openid-configuration` }]);
});

for (const interruptedSignal of ['SIGTERM', 'SIGINT']) test(`callback cancellation stops its child and blocks subsequent work on ${interruptedSignal}`, async () => {
  const runner = new URL('../../packages/auth/test-harness/run-microsoft-callback.mjs', import.meta.url).href;
  const script = `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import { createCallbackCancellation } from ${JSON.stringify(runner)};
    const owned = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
    await once(owned, 'spawn');
    const exited = once(owned, 'exit');
    let stops = 0, callbackStarted = false;
    const cancellation = createCallbackCancellation(async () => { stops++; owned.kill('SIGTERM'); await exited; });
    console.log(JSON.stringify({ready:true,childPid:owned.pid}));
    try {
      await new Promise(resolve => cancellation.signal.addEventListener('abort',resolve,{once:true}));
      cancellation.signal.throwIfAborted();
      callbackStarted = true;
    } catch {} finally { await cancellation.dispose(); }
    console.log(JSON.stringify({stops,callbackStarted,childStopped:owned.exitCode!==null||owned.signalCode!==null,
      signal:cancellation.interruptedSignal,remainingHandlers:process.listenerCount('SIGTERM')+process.listenerCount('SIGINT')}));
    process.exitCode = cancellation.interruptedSignal==='SIGINT'?130:143;
  `;
  const coordinator = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', signalled = false, childPid;
  const timer = setTimeout(() => { coordinator.kill('SIGKILL'); if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} } }, 10_000);
  const result = await new Promise((resolve, reject) => {
    coordinator.stdout.on('data', chunk => {
      stdout += chunk;
      if (!signalled && stdout.includes('\n')) {
        const ready = JSON.parse(stdout.split('\n')[0]); childPid = ready.childPid;
        signalled = true; coordinator.kill(interruptedSignal);
      }
    });
    coordinator.stderr.on('data', chunk => { stderr += chunk; });
    coordinator.once('error', reject);
    coordinator.once('close', status => resolve(status));
  }).finally(() => clearTimeout(timer));
  assert.equal(result, interruptedSignal === 'SIGINT' ? 130 : 143, stderr);
  const outcome = JSON.parse(stdout.trim().split('\n')[1]);
  assert.deepEqual(outcome, { stops: 1, callbackStarted: false, childStopped: true, signal: interruptedSignal, remainingHandlers: 0 });
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('callback cancellation reports cleanup failure without an unhandled rejection', async () => {
  const { createCallbackCancellation } = await import('../../packages/auth/test-harness/run-microsoft-callback.mjs');
  const before = process.listenerCount('SIGTERM');
  const cancellation = createCallbackCancellation(async () => { throw new Error('owned child stop failed'); });
  process.emit('SIGTERM');
  assert.equal(cancellation.signal.aborted, true);
  await assert.rejects(cancellation.dispose(), /owned child stop failed/);
  assert.equal(process.listenerCount('SIGTERM'), before);
});
