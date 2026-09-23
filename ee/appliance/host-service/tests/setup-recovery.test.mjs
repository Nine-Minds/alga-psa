import test from 'node:test';
import assert from 'node:assert/strict';

import { classifySetupRecovery } from '../setup-recovery.mjs';

test('a confirmed install-code error classifies as a code problem with reissue advice', () => {
  const recovery = classifySetupRecovery({
    failure: {
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details: 'Install code has already been used. Request a fresh one from the portal (re-issue).',
      correctable: true,
      retrySafe: false
    }
  });

  assert.ok(recovery, 'redeem failure must be classified');
  assert.equal(recovery.kind, 'code');
  assert.equal(recovery.confirmedCodeError, true);
  assert.equal(recovery.hasNetworkEvidence, false);
  assert.equal(recovery.reEditable, true);
  assert.match(recovery.title, /Install code needs attention/);
  assert.match(recovery.body, /invalid, expired, or already used/);
  assert.match(recovery.body, /Re-issue a fresh code/);
  // A code error has no transport diagnostic and must not claim a network fault.
  assert.equal(recovery.diagnostic, null);
  assert.doesNotMatch(recovery.body, /could not reach/i);
});

test('a DNS/TLS redeem failure shows the failed connection address and labels the later lookup', () => {
  const recovery = classifySetupRecovery({
    failure: {
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details:
        'Could not reach the license service at https://lic.example/register: ERR_SSL_TLSV1_UNRECOGNIZED_NAME. Destination: lic.example; DNS servers: 192.0.2.53; failed connection resolved: 10.0.0.5; resolved addresses: 203.0.113.10; socket/TLS code: ERR_SSL_TLSV1_UNRECOGNIZED_NAME.',
      retrySafe: true,
      network: {
        hostname: 'lic.example',
        servers: ['192.0.2.53'],
        // The failed connection followed the customer search domain to the
        // wildcard address; the later explicit lookup returns the real one.
        lookupAddresses: ['10.0.0.5'],
        addresses: ['203.0.113.10'],
        dnsOk: true,
        dnsError: null,
        code: 'ERR_SSL_TLSV1_UNRECOGNIZED_NAME'
      }
    }
  });

  assert.ok(recovery, 'redeem failure must be classified');
  assert.equal(recovery.kind, 'network');
  assert.equal(recovery.confirmedCodeError, false);
  assert.equal(recovery.hasNetworkEvidence, true);
  assert.equal(recovery.reEditable, true);
  assert.match(recovery.title, /Could not reach the licensing service/);
  assert.match(recovery.body, /network problem/);
  assert.match(recovery.diagnostic, /Destination lic\.example/);
  assert.match(recovery.diagnostic, /DNS servers 192\.0\.2\.53/);
  // The wildcard address that broke TLS is the failed connection's address.
  assert.match(recovery.diagnostic, /the failed connection used 10\.0\.0\.5/);
  assert.match(recovery.diagnostic, /socket\/TLS code ERR_SSL_TLSV1_UNRECOGNIZED_NAME/);
  // The later lookup is explicitly labelled, not presented as the connection's.
  assert.match(recovery.diagnostic, /a later diagnostic lookup returned 203\.0\.113\.10/);
  assert.doesNotMatch(recovery.diagnostic, /(^|· )resolved 203\.0\.113\.10/);
});

test('a DNS failure with no address reports that no address was resolved', () => {
  const recovery = classifySetupRecovery({
    failure: {
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details: 'Could not reach the license service: ENOTFOUND',
      retrySafe: true,
      network: {
        hostname: 'lic.example',
        servers: ['192.0.2.53'],
        lookupAddresses: [],
        addresses: [],
        dnsOk: false,
        dnsError: 'no address resolved',
        code: 'ENOTFOUND'
      }
    }
  });

  assert.equal(recovery.kind, 'network');
  assert.match(recovery.diagnostic, /the failed connection resolved no address/);
  assert.match(recovery.diagnostic, /a later diagnostic lookup also failed: no address resolved/);
  assert.match(recovery.diagnostic, /socket\/TLS code ENOTFOUND/);
});

test('a non-network redemption failure uses neutral guidance, not a reachability claim', () => {
  const invalidUrl = classifySetupRecovery({
    failure: {
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details: 'Invalid license service URL (ALGA_LICENSE_SERVICE_URL): must be https.',
      retrySafe: true
    }
  });

  assert.ok(invalidUrl, 'redeem failure must be classified');
  assert.equal(invalidUrl.kind, 'other');
  assert.equal(invalidUrl.confirmedCodeError, false);
  assert.equal(invalidUrl.hasNetworkEvidence, false);
  assert.equal(invalidUrl.reEditable, true);
  assert.doesNotMatch(invalidUrl.title, /Could not reach/i);
  assert.doesNotMatch(invalidUrl.body, /could not reach/i);
  assert.doesNotMatch(invalidUrl.body, /re-issue a fresh code/i);
  assert.match(invalidUrl.body, /contact support/);
  assert.equal(invalidUrl.diagnostic, 'Invalid license service URL (ALGA_LICENSE_SERVICE_URL): must be https.');

  const refusedRedirect = classifySetupRecovery({
    failure: {
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details: 'Install-code redemption was redirected away from lic.example; refusing to forward the install code.',
      retrySafe: true
    }
  });
  assert.equal(refusedRedirect.kind, 'other');
  assert.doesNotMatch(refusedRedirect.body, /could not reach/i);
});

test('non-redemption failures do not offer install-code re-entry', () => {
  assert.equal(classifySetupRecovery({ failure: { step: 'resolve-registry-host', retrySafe: true } }), null);
  assert.equal(classifySetupRecovery({ failure: null }), null);
  assert.equal(classifySetupRecovery({}), null);
  assert.equal(classifySetupRecovery(null), null);
});
