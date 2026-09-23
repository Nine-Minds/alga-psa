import test from 'node:test';
import assert from 'node:assert/strict';

import { classifySetupRecovery } from '../setup-recovery.mjs';

test('a confirmed install-code error classifies as a code problem', () => {
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
  assert.equal(recovery.reEditable, true);
  assert.equal(recovery.hostname, null);
  assert.deepEqual(recovery.dnsServers, []);
});

test('a DNS/TLS redeem failure classifies as network, never as a code problem', () => {
  const recovery = classifySetupRecovery({
    failure: {
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details:
        'Could not reach the license service at https://lic.example/register: ENOTFOUND. Destination: lic.example; DNS servers: 192.0.2.53; resolved addresses: none; DNS lookup: no address resolved; socket/TLS code: ENOTFOUND.',
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

  assert.ok(recovery, 'redeem failure must be classified');
  assert.equal(recovery.kind, 'network');
  assert.equal(recovery.confirmedCodeError, false);
  assert.equal(recovery.reEditable, true);
  assert.equal(recovery.hostname, 'lic.example');
  assert.deepEqual(recovery.dnsServers, ['192.0.2.53']);
  assert.equal(recovery.dnsOk, false);
  assert.equal(recovery.dnsError, 'no address resolved');
  assert.equal(recovery.socketCode, 'ENOTFOUND');
  assert.match(recovery.details, /Destination: lic\.example/);
});

test('a transport failure with no structured network block still resolves as network', () => {
  const recovery = classifySetupRecovery({
    failure: {
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details: 'Could not reach the license service: connection reset',
      retrySafe: true
    }
  });

  assert.ok(recovery, 'redeem failure must be classified');
  assert.equal(recovery.kind, 'network');
  assert.equal(recovery.confirmedCodeError, false);
});

test('non-redemption failures do not offer install-code re-entry', () => {
  assert.equal(classifySetupRecovery({ failure: { step: 'resolve-registry-host', retrySafe: true } }), null);
  assert.equal(classifySetupRecovery({ failure: null }), null);
  assert.equal(classifySetupRecovery({}), null);
  assert.equal(classifySetupRecovery(null), null);
});
