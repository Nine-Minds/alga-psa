import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFluxSource,
  applyReleaseSelectionConfiguration,
  applyRuntimeValuesAndReleaseSelection,
  persistSetupInputs,
  validateSetupInputs
} from '../setup-engine.mjs';

test('T004 control-plane workflow persists setup, release/runtime selection, initial tenant Secret, Flux source, and resumes from state files', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-control-plane-workflow-'));
  const stateFile = path.join(tmp, 'var', 'install-state.json');
  const setupInputsFile = path.join(tmp, 'var', 'setup-inputs.json');
  const releaseSelectionFile = path.join(tmp, 'var', 'release-selection.json');
  const runtimeValuesDir = path.join(tmp, 'runtime-values');
  const binDir = path.join(tmp, 'bin');
  const kubectlLog = path.join(tmp, 'kubectl.log');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'kubectl'), `#!/usr/bin/env bash\necho "$@" >> "${kubectlLog}"\nexit 0\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${binDir}:${oldPath}`;

  try {
    const inputs = validateSetupInputs({
      channel: 'stable',
      appHostname: 'http://psa.example.com:3000',
      dnsMode: 'system',
      repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
      repoBranch: 'release/1.0.0',
      tenantName: 'Acme MSP',
      adminFirstName: 'Ava',
      adminLastName: 'Admin',
      adminEmail: 'Ava@example.com',
      adminPassword: 'Str0ng!Pass',
      adminPasswordConfirm: 'Str0ng!Pass'
    });

    persistSetupInputs(inputs, setupInputsFile);
    assert.equal(JSON.parse(fs.readFileSync(setupInputsFile, 'utf8')).initialTenant.adminEmail, 'ava@example.com');

    const manifest = {
      schema: 'alga.appliance.release/v1',
      version: '1.0-test',
      valuesProfile: 'single-node',
      images: {
        algaCore: 'alga-core:test',
        workflowWorker: 'workflow:test',
        emailService: 'email:test',
        temporalWorker: 'temporal-worker:test'
      },
      controlPlane: 'cp:test',
      config: { repository: 'ghcr.io/nine-minds/alga-appliance-config', tag: '1.0-test', digest: 'sha256:cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe' },
      charts: { sebastian: '0.0.1' },
      profileValues: {
        'alga-core.single-node.yaml': 'bootstrap:\n  mode: recover\nsetup:\n  image:\n    tag: old\nserver:\n  image:\n    tag: old\nappUrl: ""\nhost: ""\ndomainSuffix: ""\n',
        'pgbouncer.single-node.yaml': 'pgbouncer: packaged\n',
        'temporal.single-node.yaml': 'temporal: packaged\n',
        'workflow-worker.single-node.yaml': 'image:\n  tag: old\n',
        'email-service.single-node.yaml': 'image:\n  tag: old\n',
        'temporal-worker.single-node.yaml': 'image:\n  tag: old\n'
      }
    };
    const releaseSelection = {
      ok: true,
      channel: 'stable',
      releaseVersion: '1.0-test',
      registryHost: 'ghcr.io',
      repository: 'nine-minds/alga-appliance-release',
      manifestDigest: 'sha256:abc',
      manifest
    };

    const releaseConfig = applyReleaseSelectionConfiguration(inputs, releaseSelection, { stateFile, releaseSelectionFile });
    assert.equal(releaseConfig.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(releaseSelectionFile, 'utf8')).runtime.appHostname, 'http://psa.example.com:3000');

    const runtime = await applyRuntimeValuesAndReleaseSelection(inputs, releaseSelection, {
      stateFile,
      runtimeValuesDir,
      kubeconfigPath: path.join(tmp, 'k3s.yaml'),
      tokenFile: path.join(tmp, 'setup-token')
    });

    assert.equal(runtime.ok, true, JSON.stringify(runtime));
    const initialTenantSecret = fs.readFileSync(path.join(runtimeValuesDir, 'initial-tenant-secret.yaml'), 'utf8');
    assert.match(initialTenantSecret, /kind: Secret/);
    assert.match(initialTenantSecret, /name: appliance-initial-tenant/);
    assert.match(initialTenantSecret, /INITIAL_TENANT_NAME: "Acme MSP"/);
    assert.match(initialTenantSecret, /INITIAL_ADMIN_EMAIL: "ava@example.com"/);
    assert.match(initialTenantSecret, /INITIAL_ADMIN_PASSWORD: "Str0ng!Pass"/);
    assert.doesNotMatch(fs.readFileSync(stateFile, 'utf8'), /Str0ng!Pass/);
    assert.match(fs.readFileSync(kubectlLog, 'utf8'), /create namespace msp/);
    assert.match(fs.readFileSync(kubectlLog, 'utf8'), /create secret generic appliance-status-auth/);
    assert.match(fs.readFileSync(kubectlLog, 'utf8'), /create configmap appliance-release-selection/);

    const flux = applyFluxSource(inputs, releaseSelection, {
      stateFile,
      fluxPath: 'base',
      fluxSourceApplyCommand: 'true'
    });
    assert.equal(flux.ok, true);
    assert.equal(flux.source.url, 'oci://ghcr.io/nine-minds/alga-appliance-config');
    assert.equal(flux.source.digest, 'sha256:cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe');
    assert.equal(flux.source.path, 'base');

    const resumedInputs = JSON.parse(fs.readFileSync(setupInputsFile, 'utf8'));
    const resumedRelease = JSON.parse(fs.readFileSync(releaseSelectionFile, 'utf8'));
    const resumedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(resumedInputs.initialTenant.tenantName, 'Acme MSP');
    assert.equal(resumedRelease.selectedReleaseVersion, '1.0-test');
    assert.equal(resumedState.status, 'flux-source-complete');
  } finally {
    process.env.PATH = oldPath;
  }
});
