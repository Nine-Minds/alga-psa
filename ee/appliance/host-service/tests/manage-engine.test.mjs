import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWellFormedLicenseJws,
  decodeLicenseClaims,
  licenseStatusFromClaims,
  readLicenseStatus,
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

// --- License read: candidate reproductions --------------------------------
//
// The appliance Manage tab must mirror the portal, which derives the displayed
// edition from the *license token's* `tier` claim, not from `edition_choice`
// (the build edition, always 'ee' on an appliance). The claims actually minted
// for appliance licenses carry `tier` + numeric `exp` (see
// packages/licensing/src/lib/license-types.ts), so the token is authoritative.

test('licenseStatusFromClaims treats the token tier as authoritative over the build edition', () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const claims = decodeLicenseClaims(jwsWith({ tier: 'pro', exp: future }));
  const status = licenseStatusFromClaims(claims, 'ee');
  // Candidate 5: the 'ee' build edition must not mask the Pro license tier.
  assert.equal(status.edition, 'pro');
  assert.equal(status.status, 'active');
  assert.equal(status.perpetual, false);
});

test('licenseStatusFromClaims reads the minted claim shape (tier + numeric exp)', () => {
  // Candidate 4 (eliminated): real appliance tokens use `tier` and numeric
  // `exp`, both of which the decoder already reads.
  const future = Math.floor(Date.now() / 1000) + 3600;
  const claims = decodeLicenseClaims(jwsWith({ iss: 'nineminds-license', sub: 's', cust: 'c', tier: 'pro', iat: 1, exp: future }));
  const status = licenseStatusFromClaims(claims, null);
  assert.equal(status.edition, 'pro');
  assert.equal(status.status, 'active');
  assert.ok(status.expiresAt);
});

test('readLicenseStatus reports the live token tier as the edition', async () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const kube = fakeKube({
    run: (args) => args.includes('appliance-license-status')
      ? { ok: true, stdout: JSON.stringify({ ok: true, row: { edition_choice: 'ee', license_token: jwsWith({ tier: 'pro', exp: future }), last_checkin_at: '2026-08-01T00:00:00.000Z' } }) }
      : { ok: true, stdout: '' }
  });
  const status = await readLicenseStatus({ kube });
  assert.equal(status.source, 'live');
  assert.equal(status.edition, 'pro');
  assert.equal(status.status, 'active');
  assert.equal(status.lastCheckinAt, '2026-08-01T00:00:00.000Z');
});

test('readLicenseStatus targets the configured app deployment/namespace for the live read', async () => {
  // Candidate 1: the read path hardcoded deploy/alga-core-sebastian -n msp and
  // ignored appDeployment/appNamespace, unlike applyLicense.
  const future = Math.floor(Date.now() / 1000) + 3600;
  const kube = fakeKube({
    run: (args) => args.includes('appliance-license-status')
      ? { ok: true, stdout: JSON.stringify({ ok: true, row: { edition_choice: 'ee', license_token: jwsWith({ tier: 'pro', exp: future }) } }) }
      : { ok: true, stdout: '' }
  });
  await readLicenseStatus({ kube, appDeployment: 'custom-app', appNamespace: 'custom-ns' });
  const exec = kube.calls.find((c) => c[0] === 'run' && c[1].includes('appliance-license-status'));
  assert.ok(exec, 'expected a live status exec');
  assert.match(exec[1], /deploy\/custom-app -n custom-ns/);
});

test('readLicenseStatus distinguishes a failed live read from an absent license', async () => {
  // Candidate 2: every failure fell through to the seed fallback silently, so
  // the operator could not tell "the app was unreachable" from "no license".
  const kube = fakeKube({
    run: (args) => args.includes('appliance-license-status')
      ? { ok: false, stdout: '', stderr: 'error: unable to upgrade connection: container not found ("sebastian")' }
      : { ok: true, stdout: '' },
    json: () => ({ ok: true, value: { data: {} } })
  });
  const status = await readLicenseStatus({ kube });
  assert.equal(status.status, 'unknown');
  assert.equal(status.source, 'seed-fallback');
  assert.ok(status.liveError, 'a failed live read must be distinguishable from no license');
});

test('readLicenseStatus seed fallback prefers the registry edition and the token tier', async () => {
  // Candidate 3: the seed only ever carries activation-time data, and its
  // INSTALL_EDITION (essentials|pro) is the registry edition the portal shows —
  // EDITION_CHOICE ('ee') is the build edition and must not win.
  const future = Math.floor(Date.now() / 1000) + 3600;
  const kube = fakeKube({
    run: (args) => args.includes('appliance-license-status') ? { ok: false, stdout: '', stderr: 'boom' } : { ok: true, stdout: '' },
    json: () => ({ ok: true, value: { data: {
      EDITION_CHOICE: Buffer.from('ee').toString('base64'),
      INSTALL_EDITION: Buffer.from('pro').toString('base64'),
      LICENSE_TOKEN: Buffer.from(jwsWith({ tier: 'pro', exp: future })).toString('base64')
    } } })
  });
  const status = await readLicenseStatus({ kube });
  assert.equal(status.source, 'seed-fallback');
  assert.equal(status.edition, 'pro');
  assert.equal(status.status, 'active');
  assert.ok(status.liveError);
});

test('redeemClaimCode targets the configured app deployment/namespace', async () => {
  // Candidate 1 (shared): redemption hardcoded the same deployment/namespace.
  const result = { edition: 'pro', licenseToken: 'a.b.c', applianceId: 'appliance-1', applianceCredential: 'credential', checkInUrl: 'https://license.example/check-in' };
  const kube = fakeKube({ run: (args) => args.includes('appliance-redeem-claim-code')
    ? { ok: true, stdout: JSON.stringify({ ok: true, result }) }
    : { ok: true, stdout: '' } });
  await redeemClaimCode({ claimCode: 'ABCD', kube, appDeployment: 'custom-app', appNamespace: 'custom-ns' });
  const exec = kube.calls.find((c) => c[0] === 'run' && c[1].includes('appliance-redeem-claim-code'));
  assert.ok(exec, 'expected a redeem exec');
  assert.match(exec[1], /deploy\/custom-app -n custom-ns/);
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

test('applyAppUrl rewrites app and temporal-worker values, persists runtime, and reconciles both releases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable', runtime: { appHostname: 'https://alga.local' } }));

  const coreYaml = 'appUrl: https://alga.local\nhost: alga.local\ndomainSuffix: alga.local\nserver:\n  image:\n    tag: latest\n';
  const temporalWorkerYaml = 'applicationUrl: http://alga-core.msp.svc.cluster.local:3000\npublicBaseUrl: https://alga.local\nimage:\n  tag: latest\n';
  const appliedManifests = [];
  const kube = fakeKube({
    json: (args) => {
      if (args.includes('configmap appliance-values-alga-core')) {
        return { ok: true, value: { data: { 'alga-core.single-node.yaml': coreYaml } } };
      }
      if (args.includes('configmap appliance-values-temporal-worker')) {
        return { ok: true, value: { data: { 'temporal-worker.single-node.yaml': temporalWorkerYaml } } };
      }
      return { ok: true, value: {} };
    },
    apply: (manifest) => { appliedManifests.push(manifest); return { ok: true }; }
  });

  const res = await applyAppUrl({
    appHostname: 'http://192.168.1.50:3000',
    dnsMode: 'system',
    kube,
    releaseSelectionFile
  });
  assert.equal(res.ok, true);

  // Both ConfigMaps were rewritten with the new public URL.
  const newCoreYaml = appliedManifests
    .find((manifest) => manifest.metadata.name === 'appliance-values-alga-core')
    .data['alga-core.single-node.yaml'];
  assert.match(newCoreYaml, /appUrl: "http:\/\/192\.168\.1\.50:3000"/);
  assert.match(newCoreYaml, /host: "192\.168\.1\.50"/);
  assert.match(newCoreYaml, /domainSuffix: ""/);

  const newTemporalWorkerYaml = appliedManifests
    .find((manifest) => manifest.metadata.name === 'appliance-values-temporal-worker')
    .data['temporal-worker.single-node.yaml'];
  assert.match(newTemporalWorkerYaml, /applicationUrl: http:\/\/alga-core\.msp\.svc\.cluster\.local:3000/);
  assert.match(newTemporalWorkerYaml, /publicBaseUrl: "http:\/\/192\.168\.1\.50:3000"/);

  // Operator intent persisted.
  const persisted = JSON.parse(fs.readFileSync(releaseSelectionFile, 'utf8'));
  assert.equal(persisted.runtime.appHostname, 'http://192.168.1.50:3000');

  // Both HelmRelease reconciles were requested.
  assert.ok(kube.calls.some((c) => c[0] === 'run' && c[1].includes('annotate helmrelease alga-core')), 'expected a helmrelease reconcile');
  assert.ok(kube.calls.some((c) => c[0] === 'run' && c[1].includes('annotate helmrelease temporal-worker')), 'expected a temporal-worker reconcile');
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
  const startedAt = new Date().toISOString();
  fs.writeFileSync(installStateFile, JSON.stringify({
    status: 'update-running',
    lastAction: 'updating',
    update: { owner: { pid: 42, startedAt } }
  }));

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
    resolveControlPlaneRef: async () => 'ghcr.io/x/cp@sha256:NEW',
    updateOwnerIsPidAlive: () => true
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

test('collectManageStatus marks a failed live license read while still showing the seed edition', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-license-fallback-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable' }));
  const future = Math.floor(Date.now() / 1000) + 3600;
  const kube = fakeKube({
    run: (args) => args.includes('appliance-license-status')
      ? { ok: false, stdout: '', stderr: 'error: unable to upgrade connection' }
      : { ok: true, stdout: '' },
    json: (args) => args.includes('secret appliance-license-seed')
      ? { ok: true, value: { data: {
        EDITION_CHOICE: Buffer.from('ee').toString('base64'),
        INSTALL_EDITION: Buffer.from('pro').toString('base64'),
        LICENSE_TOKEN: Buffer.from(jwsWith({ tier: 'pro', exp: future })).toString('base64')
      } } }
      : { ok: true, value: {} }
  });
  const status = await collectManageStatus({
    kube,
    releaseSelectionFile,
    installStateFile: path.join(tmp, 'install-state.json'),
    cpUpgradeStatusFile: path.join(tmp, 'cp.json'),
    resolveControlPlaneRef: async () => null
  });
  assert.equal(status.license.source, 'seed-fallback');
  assert.equal(status.license.edition, 'pro');
  assert.equal(status.license.status, 'active');
  assert.ok(status.license.liveError, 'the failed live read must be surfaced to the UI');
});

// The detached update child (queueUpdateWorkflow) moves install-state through
// update-queued and the storage-reconcile phase statuses; each must read as an
// in-flight or blocked update, or the Manage UI would show a running update as
// idle for those stretches.
test('collectManageStatus maps queued and storage-phase statuses onto the update lifecycle', async () => {
  const cases = [
    ['update-queued', 'running'],
    ['storage-install-running', 'running'],
    ['storage-install-blocked', 'blocked']
  ];
  for (const [installStatus, expected] of cases) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-status-map-'));
    const installStateFile = path.join(tmp, 'install-state.json');
    fs.writeFileSync(installStateFile, JSON.stringify({
      status: installStatus,
      lastAction: 'x',
      ...(expected === 'running' ? {
        update: { owner: { pid: 42, startedAt: new Date().toISOString() } }
      } : {})
    }));
    const releaseSelectionFile = path.join(tmp, 'release-selection.json');
    fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable' }));

    const status = await collectManageStatus({
      kube: fakeKube({ json: () => ({ ok: true, value: {} }) }),
      releaseSelectionFile,
      installStateFile,
      cpUpgradeStatusFile: path.join(tmp, 'cp-upgrade.json'),
      resolveControlPlaneRef: async () => null,
      updateOwnerIsPidAlive: () => true
    });

    assert.equal(status.app.update.status, expected, `install-state ${installStatus}`);
  }
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

test('collectManageStatus keeps an interrupted update blocked despite a Ready HelmRelease and exposes failure detail', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-interrupted-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable' }));
  const installStateFile = path.join(tmp, 'install-state.json');
  fs.writeFileSync(installStateFile, JSON.stringify({
    status: 'update-blocked',
    lastAction: 'The previous app update was interrupted and reset. You can start it again.',
    failure: {
      code: 'update_interrupted',
      category: 'update-interrupted',
      suspectedCause: 'interrupted by control-plane restart',
      suggestedNextStep: 'Start the app update again from the Manage page.',
      retrySafe: true
    },
    update: { requestedChannel: 'stable', scope: 'application-only' }
  }));
  const kube = fakeKube({
    json: (args) => args.includes('helmrelease alga-core')
      ? { ok: true, value: { status: { conditions: [{ type: 'Ready', status: 'True' }] } } }
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
  assert.equal(status.app.update.category, 'update-interrupted');
  assert.equal(status.app.update.suspectedCause, 'interrupted by control-plane restart');
  assert.equal(status.app.update.suggestedNextStep, 'Start the app update again from the Manage page.');
  assert.equal(status.app.update.retrySafe, true);
  assert.equal(status.app.update.requestedChannel, 'stable');
});

test('collectManageStatus treats a dead in-progress owner as interrupted', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-manage-dead-owner-'));
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable' }));
  const installStateFile = path.join(tmp, 'install-state.json');
  fs.writeFileSync(installStateFile, JSON.stringify({
    status: 'update-running',
    lastAction: 'updating',
    update: {
      requestedChannel: 'stable',
      scope: 'application-only',
      owner: { pid: 42, startedAt: '2026-08-03T19:00:00.000Z' }
    }
  }));
  const status = await collectManageStatus({
    kube: fakeKube({ json: () => ({ ok: true, value: {} }) }),
    releaseSelectionFile,
    installStateFile,
    cpUpgradeStatusFile: path.join(tmp, 'cp.json'),
    resolveControlPlaneRef: async () => null,
    updateOwnerNowMs: Date.parse('2026-08-03T20:00:00.000Z'),
    updateOwnerIsPidAlive: () => false
  });
  assert.equal(status.app.update.status, 'blocked');
  assert.equal(status.app.update.category, 'update-interrupted');
  assert.equal(status.app.update.startedAt, '2026-08-03T19:00:00.000Z');
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
