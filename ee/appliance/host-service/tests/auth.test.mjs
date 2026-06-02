import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// auth.mjs reads its file paths from env at module load, so point them at a
// throwaway dir before importing.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-auth-'));
process.env.ALGA_APPLIANCE_TOKEN_FILE = path.join(tmp, 'setup-token');
process.env.ALGA_APPLIANCE_ADMIN_CREDENTIAL_FILE = path.join(tmp, 'admin-ui-credential.json');
process.env.ALGA_APPLIANCE_SESSION_SECRET_FILE = path.join(tmp, 'session-secret');

const auth = await import('../auth.mjs');

function fakeReq(cookie) {
  return { headers: cookie ? { cookie } : {} };
}

test('generateToken yields five groups of four digits', () => {
  assert.match(auth.generateToken(), /^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/);
});

test('writeSetupToken is world-readable so the pod can read it', () => {
  auth.writeSetupToken('1111-2222-3333-4444-5555');
  const mode = fs.statSync(process.env.ALGA_APPLIANCE_TOKEN_FILE).mode & 0o777;
  assert.equal(mode, 0o644);
  assert.equal(auth.readSetupToken(), '1111-2222-3333-4444-5555');
});

test('tokensMatch compares against the stored token', () => {
  auth.writeSetupToken('1111-2222-3333-4444-5555');
  assert.equal(auth.tokensMatch('1111-2222-3333-4444-5555'), true);
  assert.equal(auth.tokensMatch(' 1111-2222-3333-4444-5555 '), true); // trims
  assert.equal(auth.tokensMatch('0000-0000-0000-0000-0000'), false);
  assert.equal(auth.tokensMatch(''), false);
});

test('credential lifecycle: unset -> configured -> verify -> clear', () => {
  auth.clearCredential();
  assert.equal(auth.getCredentialState().status, 'unset');
  assert.equal(auth.verifyPassword('whatever'), false);

  auth.setPassword('Str0ng!Pass');
  assert.equal(auth.getCredentialState().status, 'configured');
  assert.equal(auth.verifyPassword('Str0ng!Pass'), true);
  assert.equal(auth.verifyPassword('wrong'), false);

  // The stored credential must never contain the plaintext password.
  const stored = fs.readFileSync(process.env.ALGA_APPLIANCE_ADMIN_CREDENTIAL_FILE, 'utf8');
  assert.doesNotMatch(stored, /Str0ng!Pass/);

  auth.clearCredential();
  assert.equal(auth.getCredentialState().status, 'unset');
});

test('session token verifies, rejects tampering, and honours expiry', () => {
  const token = auth.createSessionToken(3600);
  assert.equal(auth.verifySessionToken(token), true);

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(auth.verifySessionToken(tampered), false);

  assert.equal(auth.verifySessionToken(auth.createSessionToken(-1)), false); // already expired
  assert.equal(auth.verifySessionToken('garbage'), false);
  assert.equal(auth.verifySessionToken(''), false);
});

test('rotateSessionSecret invalidates previously issued tokens', () => {
  const token = auth.createSessionToken(3600);
  assert.equal(auth.verifySessionToken(token), true);
  auth.rotateSessionSecret();
  assert.equal(auth.verifySessionToken(token), false);
});

test('isAuthenticated reads the session cookie', () => {
  const cookie = auth.sessionCookieHeader(3600).split(';')[0]; // "alga_appliance_session=..."
  assert.equal(auth.isAuthenticated(fakeReq(cookie)), true);
  assert.equal(auth.isAuthenticated(fakeReq('other=1')), false);
  assert.equal(auth.isAuthenticated(fakeReq()), false);
});

test('sessionCookieHeader sets HttpOnly + SameSite=Strict', () => {
  const header = auth.sessionCookieHeader(3600);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\//);
});

test('authPhase reflects credential + session state', () => {
  auth.clearCredential();
  assert.equal(auth.authPhase(fakeReq()), 'needs-token');
  auth.setPassword('Str0ng!Pass');
  assert.equal(auth.authPhase(fakeReq()), 'needs-password');
  const cookie = auth.sessionCookieHeader(3600).split(';')[0];
  assert.equal(auth.authPhase(fakeReq(cookie)), 'authenticated');
  auth.clearCredential();
});

test('lockout engages after repeated failures and clears on success', () => {
  auth._resetLockoutState();
  const ip = '203.0.113.7';
  assert.equal(auth.checkLockout(ip).locked, false);
  for (let i = 0; i < 5; i += 1) auth.registerFailure(ip);
  assert.equal(auth.checkLockout(ip).locked, true);
  assert.ok(auth.checkLockout(ip).retryAfterMs > 0);

  auth._resetLockoutState();
  for (let i = 0; i < 4; i += 1) auth.registerFailure(ip);
  auth.registerSuccess(ip);
  assert.equal(auth.checkLockout(ip).locked, false);
});
