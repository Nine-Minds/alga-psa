import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const statusPage = fs.readFileSync(
  path.join(repoRoot, 'ee', 'appliance', 'status-ui', 'app', 'page.tsx'),
  'utf8',
);

test('the install-code banner blames the code only for a confirmed code error', () => {
  const gateIndex = statusPage.indexOf('status?.setupReEditable');
  const codeBranchIndex = statusPage.indexOf('setupRecoveryConfirmedCodeError ?');
  const reissueIndex = statusPage.indexOf('Re-issue a fresh code at');
  const networkIndex = statusPage.indexOf('Could not reach the licensing service');

  assert.notEqual(gateIndex, -1, 'banner is still gated on setupReEditable');
  assert.notEqual(codeBranchIndex, -1, 'banner branches on the confirmed-code classification');
  assert.notEqual(reissueIndex, -1, 'reissue advice is still present');
  assert.notEqual(networkIndex, -1, 'a network-failure variant is present');

  // Reissue advice sits in the confirmed-code branch; the network variant is the
  // else branch, so a DNS/TLS failure cannot show the "invalid/expired/used" text.
  assert.ok(reissueIndex > codeBranchIndex, 'reissue advice must be inside the confirmed-code branch');
  assert.ok(networkIndex > reissueIndex, 'network guidance must be the non-code branch');
});

test('the network install-code banner shows the hostname/DNS diagnostic', () => {
  assert.match(statusPage, /installCodeNetworkDiagnostic\s*\(/);
  assert.match(statusPage, /setupRecoveryNetworkDiagnostic/);
  assert.match(statusPage, /recovery\.hostname/);
  assert.match(statusPage, /recovery\.dnsServers/);
  assert.match(statusPage, /recovery\.socketCode/);
});

test('both install-code banner variants keep the re-entry action', () => {
  const matches = statusPage.match(/Re-enter install code/g) || [];
  assert.equal(matches.length, 1, 'one shared re-entry link covers both variants');
  const linkIndex = statusPage.indexOf('Re-enter install code');
  const networkIndex = statusPage.indexOf('Could not reach the licensing service');
  assert.ok(linkIndex > networkIndex, 'the re-entry link is rendered after both branches');
  assert.match(statusPage, /href="\/setup\/"/);
});
