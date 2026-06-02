// Authentication for the appliance setup/status UI.
//
// The UI moved from a per-request `?token=` bearer to a real login layer:
//   1. First boot the appliance is in `unset` state. The operator enters the
//      one-time setup token (printed on the console) and chooses a management
//      password. The token is consumed by the state flip, not deleted.
//   2. Thereafter the appliance is `configured`: the operator logs in with the
//      password and rides a signed session cookie.
//   3. `sudo alga-appliance-reset-admin` clears the credential, rotates the
//      session secret, and re-arms a fresh token (back to `unset`).
//
// All state lives in the host volume (`/var/lib/alga-appliance`), which the
// control-plane pod RW-mounts via hostPath, so it survives pod restarts and
// reboots and is reachable by both the pod and the host-side reset CLI.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const tokenFile = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const credentialFile = process.env.ALGA_APPLIANCE_ADMIN_CREDENTIAL_FILE || '/var/lib/alga-appliance/admin-ui-credential.json';
const sessionSecretFile = process.env.ALGA_APPLIANCE_SESSION_SECRET_FILE || '/var/lib/alga-appliance/session-secret';

export const SESSION_COOKIE = 'alga_appliance_session';
const SESSION_TTL_SECONDS = Number(process.env.ALGA_APPLIANCE_SESSION_TTL_SECONDS || 7 * 24 * 60 * 60);

// scrypt parameters. cost N=2^14 keeps verification well under a few hundred ms
// on the appliance while staying expensive to brute-force offline.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

// --- low-level file helpers ------------------------------------------------

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
}

function writeSecureFile(file, content) {
  ensureDir(file);
  fs.writeFileSync(file, content, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort in local dev */ }
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- setup token -----------------------------------------------------------

export function generateToken() {
  // 5 groups of 4 digits. Numeric groups are far easier to type from a VM
  // console PIN field than mixed-case while still giving ~66 bits of entropy.
  return Array.from({ length: 5 }, () => String(crypto.randomInt(0, 10_000)).padStart(4, '0')).join('-');
}

export function readSetupToken() {
  try {
    return fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

// The token is shared with the control-plane pod (UID 10001) via the hostPath
// volume, so it is written world-readable (0644). It is a single-use,
// soon-inert setup token on a single-admin appliance.
export function writeSetupToken(token) {
  ensureDir(tokenFile);
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o644 });
  try { fs.chmodSync(tokenFile, 0o644); } catch { /* best effort */ }
}

export function tokensMatch(provided) {
  const expected = readSetupToken();
  if (!expected) return false;
  return timingSafeEqualStr(String(provided || '').trim(), expected);
}

// --- credential ------------------------------------------------------------

export function getCredentialState() {
  const stored = readJson(credentialFile);
  if (stored && stored.status === 'configured' && stored.hash && stored.salt) {
    return { status: 'configured', updatedAt: stored.updatedAt || null };
  }
  return { status: 'unset' };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, Buffer.from(salt, 'hex'), SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  }).toString('hex');
}

export function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  writeSecureFile(credentialFile, `${JSON.stringify({
    status: 'configured',
    algorithm: 'scrypt',
    params: SCRYPT_PARAMS,
    salt,
    hash,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

export function verifyPassword(password) {
  const stored = readJson(credentialFile);
  if (!stored || stored.status !== 'configured' || !stored.hash || !stored.salt) return false;
  let computed;
  try {
    computed = crypto.scryptSync(password, Buffer.from(stored.salt, 'hex'), (stored.params?.keylen) || SCRYPT_PARAMS.keylen, {
      N: stored.params?.N || SCRYPT_PARAMS.N,
      r: stored.params?.r || SCRYPT_PARAMS.r,
      p: stored.params?.p || SCRYPT_PARAMS.p,
    }).toString('hex');
  } catch {
    return false;
  }
  return timingSafeEqualStr(computed, stored.hash);
}

export function clearCredential() {
  try {
    if (fs.existsSync(credentialFile)) fs.unlinkSync(credentialFile);
  } catch { /* best effort; reset CLI runs as root */ }
}

// --- session secret + signed cookie ----------------------------------------

// Read the secret from disk on every call (no in-memory cache). The file is
// tiny and the management UI is low-traffic, and this makes a reset (which
// deletes/rotates the file) take effect immediately for the running pod — old
// session cookies stop verifying the moment the secret changes.
function getSessionSecret() {
  try {
    const existing = fs.existsSync(sessionSecretFile) ? fs.readFileSync(sessionSecretFile, 'utf8').trim() : '';
    if (existing) return existing;
  } catch { /* fall through to (re)generate */ }
  const secret = crypto.randomBytes(32).toString('hex');
  writeSecureFile(sessionSecretFile, `${secret}\n`);
  return secret;
}

export function rotateSessionSecret() {
  const secret = crypto.randomBytes(32).toString('hex');
  writeSecureFile(sessionSecretFile, `${secret}\n`);
  return secret;
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
}

export function createSessionToken(ttlSeconds = SESSION_TTL_SECONDS) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = { iat: nowSeconds, exp: nowSeconds + ttlSeconds };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!timingSafeEqualStr(signature, signPayload(payloadB64))) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  return typeof payload?.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
}

function parseCookies(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function isAuthenticated(req) {
  const cookies = parseCookies(req.headers?.cookie);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

// No Secure flag: the appliance serves plain HTTP on the LAN (same exposure as
// the previous `?token=` scheme). HttpOnly + SameSite=Strict still apply.
export function sessionCookieHeader(ttlSeconds = SESSION_TTL_SECONDS) {
  const token = createSessionToken(ttlSeconds);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttlSeconds}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// --- auth phase for the UI -------------------------------------------------

export function authPhase(req) {
  if (isAuthenticated(req)) return 'authenticated';
  return getCredentialState().status === 'configured' ? 'needs-password' : 'needs-token';
}

// --- per-IP lockout --------------------------------------------------------
// In-process and intentionally simple: after MAX_FAILURES consecutive failures
// from an IP, lock with escalating backoff. Reset on success. Counters reset on
// pod restart, which is acceptable for a single-admin LAN appliance.

const MAX_FAILURES = Number(process.env.ALGA_APPLIANCE_AUTH_MAX_FAILURES || 5);
const BASE_LOCK_MS = Number(process.env.ALGA_APPLIANCE_AUTH_BASE_LOCK_MS || 60_000);
const MAX_LOCK_MS = Number(process.env.ALGA_APPLIANCE_AUTH_MAX_LOCK_MS || 15 * 60_000);
const attempts = new Map();

export function checkLockout(ip) {
  const entry = attempts.get(ip);
  if (!entry || !entry.lockedUntil) return { locked: false, retryAfterMs: 0 };
  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) {
    entry.lockedUntil = 0;
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: remaining };
}

export function registerFailure(ip) {
  const entry = attempts.get(ip) || { failures: 0, lockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    const over = entry.failures - MAX_FAILURES;
    entry.lockedUntil = Date.now() + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** over);
  }
  attempts.set(ip, entry);
}

export function registerSuccess(ip) {
  attempts.delete(ip);
}

// Test-only: reset in-memory lockout state.
export function _resetLockoutState() {
  attempts.clear();
}
