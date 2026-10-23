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
  assert.equal(r.edition, 'pro');
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

test('redeemInstallCode production path uses the shared resolver transport with a POST body', async () => {
  const calls = [];
  const requestImpl = async (url, timeoutMs, servers, options) => {
    calls.push({ url, timeoutMs, servers, options });
    return {
      statusCode: 200,
      body: JSON.stringify({ tenant_id: 'tenant-1', edition: 'essentials' })
    };
  };
  const r = await redeemInstallCode({
    serviceUrl: 'https://lic.example',
    installCode: 'K7QPM2RX',
    applianceId: 'appliance-x',
    lookupServers: ['192.0.2.53', '192.0.2.54'],
    requestImpl
  });
  assert.equal(r.tenantId, 'tenant-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://lic.example/register');
  assert.deepEqual(calls[0].servers, ['192.0.2.53', '192.0.2.54']);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { claim_code: 'K7QPM2RX', appliance_id: 'appliance-x' });
  assert.equal(calls[0].options.rejectRedirects, true);
});

test('redeemInstallCode rejects a redirect instead of forwarding the claim code', async () => {
  const requestImpl = async () => ({ statusCode: 307, body: '', headers: { location: 'https://evil.invalid/' } });
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: 'https://lic.example', installCode: 'X', applianceId: 'a', lookupServers: ['192.0.2.53'], requestImpl }),
    /redirected away/
  );
});

test('redeemInstallCode network failure names the destination and resolver path without leaking the code', async () => {
  const requestImpl = async () => { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; };
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: 'https://lic.example', installCode: 'SECRETCODE', applianceId: 'a', lookupServers: ['192.0.2.53'], requestImpl }),
    (error) => {
      assert.match(error.message, /Could not reach the license service at https:\/\/lic\.example\/register/);
      assert.match(error.message, /ENOTFOUND/);
      assert.equal(error.network.hostname, 'lic.example');
      assert.deepEqual(error.network.servers, ['192.0.2.53']);
      assert.equal(error.network.code, 'ENOTFOUND');
      assert.doesNotMatch(error.message, /SECRETCODE/);
      return true;
    }
  );
});

test('redeemInstallCode rejects a non-HTTPS service URL clearly', async () => {
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: 'http://lic.example', installCode: 'X', applianceId: 'a', requestImpl: async () => ({ statusCode: 200, body: '{}' }) }),
    /Invalid license service URL.*only https:/s
  );
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: 'file:///etc/passwd', installCode: 'X', applianceId: 'a', requestImpl: async () => ({ statusCode: 200, body: '{}' }) }),
    /Invalid license service URL.*only https:/s
  );
});

test('redeemInstallCode reports the failed connection address and labels a later diagnostic lookup', async () => {
  const requestImpl = async () => {
    const error = new Error('self signed certificate');
    error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';
    error.lookupAddresses = ['203.0.113.7'];
    error.lookupHostname = 'lic.example';
    throw error;
  };
  await assert.rejects(
    () => redeemInstallCode({ serviceUrl: 'https://lic.example', installCode: 'SECRETCODE', applianceId: 'a', lookupServers: [], requestImpl }),
    (error) => {
      assert.match(error.message, /The failed connection resolved lic\.example to 203\.0\.113\.7/);
      assert.match(error.message, /later diagnostic lookup of lic\.example/);
      assert.deepEqual(error.network.lookupAddresses, ['203.0.113.7']);
      assert.equal(error.network.code, 'DEPTH_ZERO_SELF_SIGNED_CERT');
      assert.doesNotMatch(error.message, /SECRETCODE/);
      return true;
    }
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
