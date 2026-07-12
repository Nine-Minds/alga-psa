#!/usr/bin/env node
/**
 * Regenerates the v1-test signing keypair and the pre-signed fixture tokens
 * used by verify-license.test.ts and license-state.test.ts.
 *
 * Usage: node packages/licensing/scripts/gen-test-fixtures.mjs
 *
 * - Writes the private key to src/lib/__test-fixtures__/v1-test.private.pem
 *   (gitignored — it must never be committed) unless one already exists.
 * - Prints the public key PEM (paste into license-keys.ts under kid v1-test)
 *   and the five fixture tokens (paste into the test files).
 *
 * The private key is also what a locally-run alga-license service signs with
 * (ALGA_LICENSE_KID=v1-test ALGA_LICENSE_PRIVATE_KEY_FILE=<this file>), which
 * is how a dev appliance exercises the real claim-code → license flow.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', '__test-fixtures__');
const privateKeyPath = join(fixturesDir, 'v1-test.private.pem');

let privatePem;
if (existsSync(privateKeyPath)) {
  privatePem = readFileSync(privateKeyPath, 'utf8');
  console.log(`Using existing private key: ${privateKeyPath}\n`);
} else {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
  console.log(`Wrote new private key: ${privateKeyPath}\n`);
}

const keyObj = createPrivateKey(privatePem);
const publicPem = createPublicKey(keyObj).export({ type: 'spki', format: 'pem' });

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signToken(claims, kid) {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  // JWS ES256 requires the raw r||s (IEEE P1363) signature form, not DER.
  const sig = cryptoSign('sha256', Buffer.from(signingInput), { key: keyObj, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

const now = Math.floor(Date.now() / 1000);
const YEAR = 365 * 24 * 3600;
const base = { iss: 'nineminds-license', cust: 'Test Corp' };

const validToken = signToken({ ...base, sub: 'lic_test001', tier: 'pro', iat: now, exp: now + YEAR }, 'v1-test');
const expiredToken = signToken({ ...base, sub: 'lic_test002', tier: 'pro', iat: now - 2 * YEAR, exp: now - YEAR }, 'v1-test');
const premiumToken = signToken({ ...base, sub: 'lic_test003', tier: 'premium', iat: now, exp: now + YEAR }, 'v1-test');
// Signed with the v1-test key but claiming kid=v1 → v1's public key rejects the signature.
const wrongKidToken = signToken({ ...base, sub: 'lic_test001', tier: 'pro', iat: now, exp: now + YEAR }, 'v1');
// validToken's payload altered after signing (tier → 'xxx'), signature left intact.
const [vh, , vs] = validToken.split('.');
const tamperedToken = `${vh}.${b64url(JSON.stringify({ ...base, sub: 'lic_test001', tier: 'xxx', iat: now, exp: now + YEAR }))}.${vs}`;

console.log('Public key PEM (license-keys.ts, kid v1-test):\n');
console.log(publicPem);
console.log(JSON.stringify({ validToken, expiredToken, premiumToken, wrongKidToken, tamperedToken }, null, 2));
