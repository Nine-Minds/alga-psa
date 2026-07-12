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
  redeemClaimCode,
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
    run: async (args, options = {}) => { calls.push(['run', args, options]); return (overrides.run && overrides.run(args, options)) || { ok: true, stdout: '', stderr: '' }; },
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

test('applyLicense verifies through the worker, patches the seed, and does not restart', async () => {
  const kube = fakeKube({ run: (args) => args.includes('appliance-apply-license-key')
    ? { ok: true, stdout: JSON.stringify({ ok: true, result: { edition: 'pro' } }) }
    : { ok: true, stdout: '' } });
  const token = jwsWith({ edition: 'pro', exp: 9999999999 });
  const res = await applyLicense({ licenseKey: token, kube });
  assert.equal(res.ok, true);
  const patch = kube.calls.find((c) => c[0] === 'run' && c[1].includes('patch secret appliance-license-seed'));
  assert.ok(patch, 'expected a secret patch');
  const tokenB64 = Buffer.from(token, 'utf8').toString('base64');
  assert.ok(patch[1].includes(tokenB64), 'patch should carry the base64 token');
  assert.equal(kube.calls.some((c) => c[0] === 'run' && c[1].includes('rollout restart')), false);
  const exec = kube.calls.find((c) => c[1].includes('appliance-apply-license-key'));
  assert.deepEqual(JSON.parse(exec[2].stdin), { licenseKey: token });
});

test('redeemClaimCode writes connected recovery seed after workflow success', async () => {
  const result = { edition: 'pro', licenseToken: 'a.b.c', applianceId: 'appliance-1', applianceCredential: 'credential', checkInUrl: 'https://license.example/check-in' };
  const kube = fakeKube({ run: (args) => args.includes('appliance-redeem-claim-code')
    ? { ok: true, stdout: JSON.stringify({ ok: true, result }) }
    : { ok: true, stdout: '' } });
  const response = await redeemClaimCode({ claimCode: 'AB-CD', kube });
  assert.equal(response.ok, true);
  const exec = kube.calls.find((c) => c[1].includes('appliance-redeem-claim-code'));
  assert.deepEqual(JSON.parse(exec[2].stdin), { claimCode: 'ABCD' });
  assert.ok(kube.calls.some((c) => c[1].includes('patch secret appliance-license-seed')));
  assert.equal(kube.calls.some((c) => c[1].includes('rollout restart')), false);
});

test('redeemClaimCode surfaces structured workflow errors despite a nonzero exit', async () => {
  // The in-pod scripts print structured JSON and exit 1 on failure — the
  // structured code must survive, not collapse into app_unavailable 503.
  const kube = fakeKube({ run: (args) => args.includes('appliance-redeem-claim-code')
    ? { ok: false, code: 1, stdout: JSON.stringify({ ok: false, code: 'invalid_claim_code', error: 'nope' }), stderr: '' }
    : { ok: true, stdout: '' } });
  const response = await redeemClaimCode({ claimCode: 'ABCDEFGH', kube });
  assert.equal(response.ok, false);
  assert.equal(response.status, 400);
  assert.match(response.error, /Invalid claim code/);
});

test('redeemClaimCode maps an exec failure with no structured output to 503', async () => {
  const kube = fakeKube({ run: (args) => args.includes('appliance-redeem-claim-code')
    ? { ok: false, code: 1, stdout: '', stderr: 'error: unable to upgrade connection' }
    : { ok: true, stdout: '' } });
  const response = await redeemClaimCode({ claimCode: 'ABCDEFGH', kube });
  assert.equal(response.ok, false);
  assert.equal(response.status, 503);
});

test('applyLicense surfaces structured workflow errors despite a nonzero exit', async () => {
  const kube = fakeKube({ run: (args) => args.includes('appliance-apply-license-key')
    ? { ok: false, code: 1, stdout: JSON.stringify({ ok: false, code: 'tenant_mismatch', error: 'wrong tenant' }), stderr: '' }
    : { ok: true, stdout: '' } });
  const res = await applyLicense({ licenseKey: jwsWith({ edition: 'pro', exp: 9999999999 }), kube });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /different account/);
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

test('collectManageStatus: app.updateAvailable true when channel digest moved past the pinned one', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-app-upd-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    selectedChannel: 'stable',
    selectedReleaseVersion: 'old-version',
    manifestDigest: 'sha256:PINNED',
    registryHost: 'ghcr.io',
    repository: 'nine-minds/alga-appliance-release'
  }));
  const kube = fakeKube({});
  const status = await collectManageStatus({
    kube,
    releaseSelectionFile,
    installStateFile: path.join(tmp, 'nope.json'),
    cpUpgradeStatusFile: path.join(tmp, 'nope2.json'),
    resolveControlPlaneRef: async () => null,
    resolveReleaseManifest: async (ref, opts) => {
      assert.equal(ref, 'stable');
      assert.equal(opts.registryHost, 'ghcr.io');
      assert.equal(opts.releaseRepository, 'nine-minds/alga-appliance-release');
      return { manifestDigest: 'sha256:NEW', manifest: { version: 'new-version' } };
    }
  });
  assert.equal(status.app.updateAvailable, true);
  assert.equal(status.app.availableVersion, 'new-version');
  assert.equal(status.app.pinnedReleaseDigest, 'sha256:PINNED');
  assert.equal(status.app.resolvedReleaseDigest, 'sha256:NEW');
});

test('collectManageStatus: app.updateAvailable false when channel digest matches the pinned one', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-app-noupd-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    selectedChannel: 'stable',
    manifestDigest: 'sha256:SAME'
  }));
  const status = await collectManageStatus({
    kube: fakeKube({}),
    releaseSelectionFile,
    installStateFile: path.join(tmp, 'nope.json'),
    cpUpgradeStatusFile: path.join(tmp, 'nope2.json'),
    resolveControlPlaneRef: async () => null,
    resolveReleaseManifest: async () => ({ manifestDigest: 'sha256:SAME', manifest: { version: 'v' } })
  });
  assert.equal(status.app.updateAvailable, false);
  assert.equal(status.app.availableVersion, null);
});

test('collectManageStatus clears a stale blocked app-update when the alga-core HelmRelease is Ready', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-stale-ok-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable' }));
  const installStateFile = path.join(tmp, 'install-state.json');
  fs.writeFileSync(installStateFile, JSON.stringify({ status: 'update-blocked', lastAction: 'HelmRelease reconcile failed during app update.' }));
  const kube = fakeKube({
    json: (args) => args.includes('helmrelease alga-core')
      ? { ok: true, value: { status: { conditions: [{ type: 'Ready', status: 'True', reason: 'ReconciliationSucceeded' }] } } }
      : { ok: true, value: {} }
  });
  const status = await collectManageStatus({
    kube,
    releaseSelectionFile,
    installStateFile,
    cpUpgradeStatusFile: path.join(tmp, 'cp.json'),
    resolveControlPlaneRef: async () => null
  });
  // Healthy app + stale failure record -> show no error.
  assert.equal(status.app.update.status, 'idle');
  assert.equal(status.app.update.message, null);
});

test('collectManageStatus keeps a blocked app-update when the alga-core HelmRelease is not Ready', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-stale-bad-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable' }));
  const installStateFile = path.join(tmp, 'install-state.json');
  fs.writeFileSync(installStateFile, JSON.stringify({ status: 'update-blocked', lastAction: 'HelmRelease reconcile failed during app update.' }));
  const kube = fakeKube({
    json: (args) => args.includes('helmrelease alga-core')
      ? { ok: true, value: { status: { conditions: [{ type: 'Ready', status: 'False', reason: 'UpgradeFailed' }] } } }
      : { ok: true, value: {} }
  });
  const status = await collectManageStatus({
    kube,
    releaseSelectionFile,
    installStateFile,
    cpUpgradeStatusFile: path.join(tmp, 'cp.json'),
    resolveControlPlaneRef: async () => null
  });
  assert.equal(status.app.update.status, 'blocked');
});

test('collectManageStatus: app.updateAvailable false (not a crash) when the registry is unreachable', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-app-err-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    selectedChannel: 'stable',
    manifestDigest: 'sha256:PINNED'
  }));
  const status = await collectManageStatus({
    kube: fakeKube({}),
    releaseSelectionFile,
    installStateFile: path.join(tmp, 'nope.json'),
    cpUpgradeStatusFile: path.join(tmp, 'nope2.json'),
    resolveControlPlaneRef: async () => null,
    resolveReleaseManifest: async () => { throw new Error('registry unreachable'); }
  });
  assert.equal(status.app.updateAvailable, false);
  assert.equal(status.app.resolvedReleaseDigest, null);
});
