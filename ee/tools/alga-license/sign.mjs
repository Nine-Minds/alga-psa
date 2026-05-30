#!/usr/bin/env node
/**
 * Alga License Signing CLI
 *
 * Internal tool for issuing offline appliance licenses (ES256 signed JWTs).
 * The private key is NEVER committed to this repo. Supply it via env or file.
 *
 * Usage:
 *   ALGA_LICENSE_PRIVATE_KEY_FILE=/path/to/private.pem \
 *   ALGA_LICENSE_KID=v1 \
 *   node sign.mjs sign --customer "Acme Corp" --tier premium --months 12 [--seats 50]
 *
 * Or set the key directly (useful for CI):
 *   ALGA_LICENSE_PRIVATE_KEY="$(cat private.pem)" node sign.mjs sign ...
 *
 * Subcommands:
 *   sign        Issue a new license
 *   gen-keypair Generate a new EC P-256 keypair (for key rotation; outputs JSON)
 *   gen-fixture Generate test fixtures (valid / expired / wrong-kid / tampered)
 *               Uses the committed v1-test keypair; for test use only.
 */

import { createSign, generateKeyPairSync } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── helpers ─────────────────────────────────────────────────────────────────

function usage() {
  console.error(`
Usage:
  sign  --customer <name> --tier pro|premium --months <n> [--seats <n>] [--kid <kid>]
  gen-keypair
  gen-fixture

Environment:
  ALGA_LICENSE_PRIVATE_KEY_FILE  path to PEM private key file
  ALGA_LICENSE_PRIVATE_KEY       PEM private key string (alternative)
  ALGA_LICENSE_KID               key id to embed in JWT header (default: v1)
`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function loadPrivateKey() {
  const keyStr = process.env.ALGA_LICENSE_PRIVATE_KEY;
  if (keyStr) return keyStr.trim();
  const keyFile = process.env.ALGA_LICENSE_PRIVATE_KEY_FILE;
  if (keyFile) return readFileSync(resolve(keyFile), 'utf8').trim();
  // No key configured. `sign` refuses; `gen-fixture` loads the test key directly.
  return null;
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJwt(payload, privateKeyPem, kid) {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // createSign with dsaEncoding 'ieee-p1363' emits the raw R||S signature that
  // JWS/ES256 expects directly (no DER-to-JOSE conversion needed).
  const signer = createSign('SHA256');
  signer.update(signingInput);
  const derSig = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  const sigB64 = base64url(derSig);

  return `${signingInput}.${sigB64}`;
}

// ── subcommands ──────────────────────────────────────────────────────────────

function cmdSign(argv) {
  const args = parseArgs(argv);
  const customer = args.customer;
  const tier = args.tier;
  const months = parseInt(args.months, 10);
  const seats = args.seats ? parseInt(args.seats, 10) : undefined;
  const kid = args.kid || process.env.ALGA_LICENSE_KID || 'v1';

  if (!customer || !tier || !months) usage();
  if (tier !== 'pro' && tier !== 'premium') {
    console.error('Error: --tier must be pro or premium'); process.exit(1);
  }
  if (isNaN(months) || months < 1) {
    console.error('Error: --months must be a positive integer'); process.exit(1);
  }

  const privateKey = loadPrivateKey();
  if (!privateKey) {
    console.error('Error: no private key — set ALGA_LICENSE_PRIVATE_KEY or ALGA_LICENSE_PRIVATE_KEY_FILE');
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + months * 30 * 24 * 60 * 60;
  const sub = `lic_${Date.now().toString(36)}`;

  const payload = {
    iss: 'nineminds-license',
    sub,
    cust: customer,
    tier,
    iat: now,
    exp,
    ...(seats !== undefined ? { seats } : {}),
  };

  const token = signJwt(payload, privateKey, kid);

  const expDate = new Date(exp * 1000).toISOString().split('T')[0];
  console.error(`License issued:`);
  console.error(`  sub:      ${sub}`);
  console.error(`  customer: ${customer}`);
  console.error(`  tier:     ${tier}`);
  console.error(`  expires:  ${expDate} (${months} month${months !== 1 ? 's' : ''})`);
  if (seats !== undefined) console.error(`  seats:    ${seats}`);
  console.error('');
  console.log(token);
}

function cmdGenKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  console.log(JSON.stringify({ publicKey, privateKey }, null, 2));
  console.error('\nIMPORTANT: add publicKey to packages/licensing/src/lib/license-keys.ts');
  console.error('           store privateKey securely — NEVER commit it to the repo');
}

function cmdGenFixture() {
  // Uses the committed test private key — safe to run without env vars.
  // __dirname is ee/tools/alga-license, so the repo root is three levels up.
  const testPrivKeyPath = resolve(__dirname, '../../../packages/licensing/src/lib/__test-fixtures__/v1-test.private.pem');
  let testPrivKey;
  try {
    testPrivKey = readFileSync(testPrivKeyPath, 'utf8').trim();
  } catch {
    console.error('Test private key not found at:', testPrivKeyPath);
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);

  // valid token (pro, 12 months)
  const validPayload = { iss: 'nineminds-license', sub: 'lic_test001', cust: 'Test Corp', tier: 'pro', iat: now, exp: now + 365 * 24 * 3600 };
  // expired token
  const expiredPayload = { ...validPayload, sub: 'lic_test002', iat: now - 400 * 24 * 3600, exp: now - 30 * 24 * 3600 };
  // premium token
  const premiumPayload = { ...validPayload, sub: 'lic_test003', tier: 'premium', exp: now + 365 * 24 * 3600 };

  const validToken = signJwt(validPayload, testPrivKey, 'v1-test');
  const expiredToken = signJwt(expiredPayload, testPrivKey, 'v1-test');
  const premiumToken = signJwt(premiumPayload, testPrivKey, 'v1-test');

  // tampered: flip one char in the payload section
  const tamperedToken = validToken.split('.').map((part, i) => {
    if (i !== 1) return part;
    const decoded = Buffer.from(part, 'base64').toString();
    return base64url(Buffer.from(decoded.replace('"pro"', '"premium"')));
  }).join('.');

  // wrong-kid token (signed with test key but kid=v1)
  const wrongKidToken = signJwt(validPayload, testPrivKey, 'v1');

  const fixtures = { validToken, expiredToken, premiumToken, tamperedToken, wrongKidToken };
  console.log(JSON.stringify(fixtures, null, 2));
}

// ── main ─────────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;
if (cmd === 'sign') cmdSign(rest);
else if (cmd === 'gen-keypair') cmdGenKeypair();
else if (cmd === 'gen-fixture') cmdGenFixture();
else usage();
