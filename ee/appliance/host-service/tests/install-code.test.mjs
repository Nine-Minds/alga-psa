import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveApplianceId, redeemInstallCode, licenseSeedFromRedeem } from '../install-code.mjs';

function mockFetch(response) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return response;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('deriveApplianceId is stable for a given hostname (no machine-id)', () => {
  const a = deriveApplianceId('alga.example.com', '/nonexistent/machine-id');
  const b = deriveApplianceId('alga.example.com', '/nonexistent/machine-id');
  assert.equal(a, b);
  assert.match(a, /^appliance-[0-9a-f]{16}$/);
  assert.notEqual(a, deriveApplianceId('other.example.com', '/nonexistent/machine-id'));
});

test('redeemInstallCode maps a paid response (token + credential + check-in)', async () => {
  const fetchImpl = mockFetch({
    ok: true,
    json: async () => ({
      tenant_id: 'tenant-uuid', edition: 'premium', company_name: 'Acme', contact_email: 'a@acme.com',
      first_jwt: 'jwt.token.here', appliance_credential: 'cred123', check_in_url: 'https://lic/check-in',
    }),
  });
  const r = await redeemInstallCode({ serviceUrl: 'https://lic/', installCode: ' k7qpm2rx ', applianceId: 'appliance-x', fetchImpl });
  assert.equal(fetchImpl.calls[0].url, 'https://lic/register');
  assert.equal(fetchImpl.calls[0].body.claim_code, 'K7QPM2RX'); // trimmed + uppercased
  assert.equal(r.tenantId, 'tenant-uuid');
  assert.equal(r.edition, 'premium');
  assert.equal(r.licenseToken, 'jwt.token.here');
  assert.equal(r.applianceCredential, 'cred123');
  assert.equal(r.checkInUrl, 'https://lic/check-in');
});

test('redeemInstallCode maps an essentials response (no token)', async () => {
  const fetchImpl = mockFetch({ ok: true, json: async () => ({ tenant_id: 't2', edition: 'essentials' }) });
  const r = await redeemInstallCode({ serviceUrl: 'https://lic', installCode: 'ABC', applianceId: 'app', fetchImpl });
  assert.equal(r.edition, 'essentials');
  assert.equal(r.licenseToken, null);
  assert.equal(r.applianceCredential, null);
});

test('redeemInstallCode surfaces a friendly message for a consumed code', async () => {
  const fetchImpl = mockFetch({ ok: false, status: 409, json: async () => ({ code: 'consumed_claim_code', error: 'used' }) });
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: 'https://lic', installCode: 'X', applianceId: 'a', fetchImpl }),
    /already been used.*re-issue/,
  );
});

test('redeemInstallCode surfaces an unreachable-service error', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: 'https://lic', installCode: 'X', applianceId: 'a', fetchImpl }),
    /Could not reach the license service/,
  );
});

test('redeemInstallCode requires a service URL', async () => {
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: '', installCode: 'X', applianceId: 'a', fetchImpl: async () => ({}) }),
    /not configured/,
  );
});

test('licenseSeedFromRedeem maps editions to seed literals', () => {
  const paid = licenseSeedFromRedeem({ edition: 'pro', licenseToken: 'jwt', applianceCredential: 'c', checkInUrl: 'u', applianceId: 'app' });
  assert.equal(paid.EDITION_CHOICE, 'ee');
  assert.equal(paid.INSTALL_EDITION, 'pro');
  assert.equal(paid.LICENSE_TOKEN, 'jwt');
  assert.equal(paid.APPLIANCE_CREDENTIAL, 'c');
  assert.equal(paid.CHECK_IN_URL, 'u');
  assert.equal(paid.APPLIANCE_ID, 'app');

  const free = licenseSeedFromRedeem({ edition: 'essentials' });
  assert.equal(free.EDITION_CHOICE, 'ee');
  assert.equal(free.INSTALL_EDITION, 'essentials');
  assert.equal(free.LICENSE_TOKEN, '');
});
