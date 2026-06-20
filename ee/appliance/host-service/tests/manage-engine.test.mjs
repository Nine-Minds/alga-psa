import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWellFormedLicenseJws,
  decodeLicenseClaims,
  licenseStatusFromClaims,
  applyLicense,
  applyAppUrl,
  collectManageStatus
} from '../manage-engine.mjs';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwsWith(claims) {
  return `${b64url({ alg: 'RS256' })}.${b64url(claims)}.${'sig'.repeat(3)}`;
}

function fakeKube(overrides = {}) {
  const calls = [];
  return {
    calls,
    json: async (args) => { calls.push(['json', args]); return (overrides.json && overrides.json(args)) || { ok: true, value: {} }; },
    run: async (args) => { calls.push(['run', args]); return (overrides.run && overrides.run(args)) || { ok: true, stdout: '', stderr: '' }; },
    apply: async (manifest) => { calls.push(['apply', manifest]); return (overrides.apply && overrides.apply(manifest)) || { ok: true, stdout: '', stderr: '' }; },
    quote: (v) => `'${String(v).replaceAll("'", "'\\''")}'`
  };
}

test('license JWS format check + claim decode + status', () => {
  assert.equal(isWellFormedLicenseJws('a.b.c'), true);
  assert.equal(isWellFormedLicenseJws('not-a-jws'), false);
  assert.equal(isWellFormedLicenseJws(''), false);

  const future = Math.floor(Date.now() / 1000) + 3600;
  const claims = decodeLicenseClaims(jwsWith({ edition: 'pro', exp: future }));
  assert.equal(claims.edition, 'pro');
  const status = licenseStatusFromClaims(claims, null);
  assert.equal(status.edition, 'pro');
  assert.equal(status.status, 'active');
  assert.equal(status.perpetual, false);
  assert.ok(status.expiresAt, 'a real near-future expiry keeps its date');

  const past = licenseStatusFromClaims({ exp: 1 }, 'ee');
  assert.equal(past.status, 'expired');
  assert.equal(past.edition, 'ee');

  // The 9999999999 "all nines" sentinel (= 2286-11-20) reads as perpetual,
  // not a literal far-future date.
  const perpetual = licenseStatusFromClaims({ edition: 'pro', exp: 9999999999 }, null);
  assert.equal(perpetual.perpetual, true);
  assert.equal(perpetual.status, 'active');
  assert.equal(perpetual.expiresAt, null);
});

test('applyLicense rejects an invalid JWS without touching kubectl', async () => {
  const kube = fakeKube();
  const res = await applyLicense({ licenseKey: 'bogus', kube });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(kube.calls.length, 0);
});

test('applyLicense patches the seed secret (base64) and restarts the app', async () => {
  const kube = fakeKube();
  const token = jwsWith({ edition: 'pro', exp: 9999999999 });
  const res = await applyLicense({ licenseKey: token, kube });
  assert.equal(res.ok, true);
  const patch = kube.calls.find((c) => c[0] === 'run' && c[1].includes('patch secret appliance-license-seed'));
  assert.ok(patch, 'expected a secret patch');
  const tokenB64 = Buffer.from(token, 'utf8').toString('base64');
  assert.ok(patch[1].includes(tokenB64), 'patch should carry the base64 token');
  assert.ok(kube.calls.some((c) => c[0] === 'run' && c[1].includes('rollout restart deploy/alga-core-sebastian')), 'expected an app rollout restart');
});

test('applyAppUrl rewrites values, persists runtime, reconciles helm', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable', runtime: { appHostname: 'https://alga.local' } }));

  const coreYaml = 'appUrl: https://alga.local\nhost: alga.local\ndomainSuffix: alga.local\nserver:\n  image:\n    tag: latest\n';
  let appliedManifest = null;
  const kube = fakeKube({
    json: (args) => args.includes('configmap appliance-values-alga-core')
      ? { ok: true, value: { data: { 'alga-core.single-node.yaml': coreYaml } } }
      : { ok: true, value: {} },
    apply: (manifest) => { appliedManifest = manifest; return { ok: true }; }
  });

  const res = await applyAppUrl({
    appHostname: 'http://192.168.1.50:3000',
    dnsMode: 'system',
    kube,
    releaseSelectionFile
  });
  assert.equal(res.ok, true);

  // Configmap was rewritten with the new URL.
  const newYaml = appliedManifest.data['alga-core.single-node.yaml'];
  assert.match(newYaml, /appUrl: "http:\/\/192\.168\.1\.50:3000"/);
  assert.match(newYaml, /host: "192\.168\.1\.50"/);
  assert.match(newYaml, /domainSuffix: ""/);

  // Operator intent persisted.
  const persisted = JSON.parse(fs.readFileSync(releaseSelectionFile, 'utf8'));
  assert.equal(persisted.runtime.appHostname, 'http://192.168.1.50:3000');

  // HelmRelease reconcile requested.
  assert.ok(kube.calls.some((c) => c[0] === 'run' && c[1].includes('annotate helmrelease alga-core')), 'expected a helmrelease reconcile');
});

test('applyAppUrl requires a hostname', async () => {
  const res = await applyAppUrl({ appHostname: '', kube: fakeKube(), releaseSelectionFile: null });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
});

test('collectManageStatus reports upgradeAvailable on digest mismatch', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-status-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    selectedChannel: 'stable',
    selectedReleaseVersion: 'v1.2.3',
    runtime: { appHostname: 'http://10.0.0.5:3000', dnsMode: 'system', dnsServers: '' }
  }));
  const installStateFile = path.join(tmp, 'install-state.json');
  fs.writeFileSync(installStateFile, JSON.stringify({ status: 'update-running', lastAction: 'updating' }));

  const kube = fakeKube({
    json: (args) => {
      if (args.includes('deployment appliance-control-plane')) {
        return { ok: true, value: { spec: { template: { spec: { containers: [{ image: 'ghcr.io/x/cp@sha256:OLD' }] } } } } };
      }
      if (args.includes('secret appliance-license-seed')) {
        return { ok: true, value: { data: { EDITION_CHOICE: Buffer.from('pro').toString('base64') } } };
      }
      return { ok: true, value: {} };
    }
  });

  const status = await collectManageStatus({
    kube,
    releaseSelectionFile,
    installStateFile,
    cpUpgradeStatusFile: path.join(tmp, 'cp-upgrade.json'),
    resolveControlPlaneRef: async () => 'ghcr.io/x/cp@sha256:NEW'
  });

  assert.equal(status.app.channel, 'stable');
  assert.equal(status.app.version, 'v1.2.3');
  assert.equal(status.app.update.status, 'running');
  assert.equal(status.controlPlane.runningDigest, 'sha256:OLD');
  assert.equal(status.controlPlane.resolvedDigest, 'sha256:NEW');
  assert.equal(status.controlPlane.upgradeAvailable, true);
  assert.equal(status.license.edition, 'pro');
  assert.equal(status.appUrl.url, 'http://10.0.0.5:3000');
  assert.equal(status.appUrl.host, '10.0.0.5');
});

test('collectManageStatus: no upgrade when digests match', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-status2-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable' }));
  const kube = fakeKube({
    json: (args) => args.includes('deployment appliance-control-plane')
      ? { ok: true, value: { spec: { template: { spec: { containers: [{ image: 'ghcr.io/x/cp@sha256:SAME' }] } } } } }
      : { ok: true, value: {} }
  });
  const status = await collectManageStatus({
    kube,
    releaseSelectionFile,
    installStateFile: path.join(tmp, 'nope.json'),
    cpUpgradeStatusFile: path.join(tmp, 'nope2.json'),
    resolveControlPlaneRef: async () => 'ghcr.io/x/cp@sha256:SAME'
  });
  assert.equal(status.controlPlane.upgradeAvailable, false);
  assert.equal(status.app.update.status, 'idle');
});
