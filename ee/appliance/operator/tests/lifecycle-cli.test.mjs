import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { runBootstrap, runRepairRelease, runUpgrade } from '../lib/lifecycle.mjs';

class MockStreamingRunner {
  constructor({ code = 0, lines = [] }) {
    this.code = code;
    this.lines = lines;
    this.calls = [];
  }

  async runStreaming(command, args, options = {}) {
    this.calls.push({ command, args });
    for (const line of this.lines) {
      options.onLine?.(line, 'stdout');
    }
    return {
      code: this.code,
      output: this.lines.join('\n'),
    };
  }
}

function makeTempRuntime({ upgradeFailure = false, resetCheck = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-operator-runtime-'));
  const scriptsDir = path.join(root, 'scripts');
  const releasesDir = path.join(root, 'releases', '1.0.0');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(releasesDir, { recursive: true });
  fs.writeFileSync(
    path.join(releasesDir, 'release.json'),
    JSON.stringify({
      releaseVersion: '1.0.0',
      app: { version: '1.0.0', releaseBranch: 'release/1.0.0' },
    }),
  );

  fs.writeFileSync(path.join(scriptsDir, 'bootstrap-appliance.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(scriptsDir, 'collect-support-bundle.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

  const upgradeScript = upgradeFailure
    ? '#!/usr/bin/env bash\necho "helmrelease/alga-core failed" >&2\nexit 1\n'
    : '#!/usr/bin/env bash\nexit 0\n';
  fs.writeFileSync(path.join(scriptsDir, 'upgrade-appliance.sh'), upgradeScript, { mode: 0o755 });

  const resetScript = resetCheck
    ? '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$HOME/reset-args.txt"\nexit 0\n'
    : '#!/usr/bin/env bash\nexit 0\n';
  fs.writeFileSync(path.join(scriptsDir, 'reset-appliance-data.sh'), resetScript, { mode: 0o755 });
  return root;
}

function makeHome(siteId = 'site-a') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-operator-home-'));
  const siteDir = path.join(home, 'nm-kube-config/alga-psa/talos', siteId);
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'kubeconfig'), 'fake');
  fs.writeFileSync(path.join(siteDir, 'talosconfig'), 'fake');
  fs.writeFileSync(path.join(siteDir, 'node-ip'), '192.168.1.50');
  return home;
}

function runCli(args, env = {}) {
  const cliPath = path.resolve('ee/appliance/operator/appliance.mjs');
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

test('T001: bootstrap resolves release from environment and classifies failure layer', async () => {
  const env = {
    runtime: {
      bootstrapScript: '/tmp/bootstrap-appliance.sh',
      assetRoot: '/tmp',
    },
    site: { configDir: '/tmp/site', siteId: 'appliance-single-node' },
    paths: { kubeconfig: '/tmp/site/kubeconfig', talosconfig: '/tmp/site/talosconfig' },
    nodeIp: '10.0.0.10',
    appUrl: 'https://psa.example.com',
    defaultReleaseVersion: '1.0.0',
  };

  const events = [];
  const runner = new MockStreamingRunner({
    code: 1,
    lines: [
      'wait for Talos maintenance API',
      'wait for Kubernetes API on 10.0.0.10',
      'Timed out waiting for Kubernetes API on 10.0.0.10',
    ],
  });

  const result = await runBootstrap(env, {
    bootstrapMode: 'recover',
    hostname: 'alga-appliance',
    onProgress: (event) => events.push(event),
    runner,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureLayer, 'kubernetes');
  assert.deepEqual(runner.calls[0].args.slice(0, 6), [
    '--site-id',
    'appliance-single-node',
    '--release-version',
    '1.0.0',
    '--bootstrap-mode',
    'recover',
  ]);
  assert(!runner.calls[0].args.includes('--kubeconfig'));
  assert(!runner.calls[0].args.includes('--talosconfig'));
  assert(events.some((event) => event.type === 'phase' && event.phase === 'Talos'));
  assert(events.some((event) => event.type === 'phase' && event.phase === 'Kubernetes'));
});

test('runBootstrap derives site id and config dir when no site is preselected', async () => {
  const env = {
    runtime: {
      bootstrapScript: '/tmp/bootstrap-appliance.sh',
      assetRoot: '/tmp',
    },
    configBaseDir: '/tmp/config-base',
    site: null,
    suggestedSiteId: 'appliance-new-site',
    paths: { kubeconfig: null, talosconfig: null },
    nodeIp: '10.0.0.10',
    appUrl: 'https://psa.example.com',
    defaultReleaseVersion: '1.0.0',
  };

  const runner = new MockStreamingRunner({
    code: 0,
    lines: ['Talos bootstrap starting'],
  });

  const result = await runBootstrap(env, {
    siteId: 'appliance-new-site',
    bootstrapMode: 'fresh',
    hostname: 'alga-appliance',
    runner,
  });

  assert.equal(result.ok, true);
  assert.match(runner.calls[0].args.join(' '), /--site-id appliance-new-site/);
  assert.match(runner.calls[0].args.join(' '), /--config-dir \/tmp\/config-base\/appliance-new-site/);
});

test('runBootstrap only reuses kubeconfig and talosconfig when explicitly provided', async () => {
  const env = {
    runtime: {
      bootstrapScript: '/tmp/bootstrap-appliance.sh',
      assetRoot: '/tmp',
    },
    site: { configDir: '/tmp/site', siteId: 'appliance-single-node' },
    paths: { kubeconfig: '/tmp/site/kubeconfig', talosconfig: '/tmp/site/talosconfig' },
    nodeIp: '10.0.0.10',
    appUrl: 'https://psa.example.com',
    defaultReleaseVersion: '1.0.0',
  };

  const runner = new MockStreamingRunner({
    code: 0,
    lines: ['Talos bootstrap starting'],
  });

  const result = await runBootstrap(env, {
    bootstrapMode: 'recover',
    hostname: 'alga-appliance',
    kubeconfig: '/tmp/override.kubeconfig',
    talosconfig: '/tmp/override.talosconfig',
    runner,
  });

  assert.equal(result.ok, true);
  assert.match(runner.calls[0].args.join(' '), /--kubeconfig \/tmp\/override\.kubeconfig/);
  assert.match(runner.calls[0].args.join(' '), /--talosconfig \/tmp\/override\.talosconfig/);
});

test('runUpgrade passes skip-reconcile only when reconcileAfterApply is disabled', async () => {
  const env = {
    runtime: {
      upgradeScript: '/tmp/upgrade-appliance.sh',
      assetRoot: '/tmp',
    },
    site: { configDir: '/tmp/site', siteId: 'appliance-single-node' },
    paths: { kubeconfig: '/tmp/site/kubeconfig' },
    defaultReleaseVersion: '1.0-rc5',
  };

  const runner = new MockStreamingRunner({
    code: 0,
    lines: ['upgrade starting'],
  });

  await runUpgrade(env, {
    releaseVersion: '1.0-rc5',
    reconcileAfterApply: false,
    runner,
  });

  assert.match(runner.calls[0].args.join(' '), /--skip-reconcile/);

  runner.calls.length = 0;

  await runUpgrade(env, {
    releaseVersion: '1.0-rc5',
    reconcileAfterApply: true,
    runner,
  });

  assert(!runner.calls[0].args.includes('--skip-reconcile'));
});

test('runRepairRelease passes cleanup toggle through to the repair script', async () => {
  const env = {
    runtime: {
      repairScript: '/tmp/repair-release.sh',
      assetRoot: '/tmp',
    },
    paths: { kubeconfig: '/tmp/site/kubeconfig' },
  };

  const runner = new MockStreamingRunner({
    code: 0,
    lines: ['repair starting'],
  });

  await runRepairRelease(env, {
    cleanupWorkloads: false,
    runner,
  });

  assert.match(runner.calls[0].args.join(' '), /--skip-cleanup-workloads/);
});

test('T002: CLI upgrade surfaces no-auto-rollback guidance on failure', async () => {
  const runtime = makeTempRuntime({ upgradeFailure: true });
  const home = makeHome();
  const result = await runCli(
    ['upgrade', '--asset-root', runtime, '--site-id', 'site-a', '--release-version', '1.0.0'],
    { HOME: home },
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Automatic rollback is disabled/i);
  assert.match(result.stdout, /support-bundle/i);
});

test('T003: CLI reset enforces force flag and invokes reset helper when confirmed', async () => {
  const runtime = makeTempRuntime({ resetCheck: true });
  const home = makeHome();

  const withoutForce = await runCli(['reset', '--asset-root', runtime, '--site-id', 'site-a'], { HOME: home });
  assert.equal(withoutForce.code, 1);
  assert.match(withoutForce.stderr, /Re-run with --force/i);

  const withForce = await runCli(['reset', '--asset-root', runtime, '--site-id', 'site-a', '--force'], { HOME: home });
  assert.equal(withForce.code, 0);
  const resetArgs = fs.readFileSync(path.join(home, 'reset-args.txt'), 'utf8');
  assert.match(resetArgs, /--kubeconfig/);
  assert.match(resetArgs, /--force/);
});

test('CLI fails fast when multiple site configs exist and --site-id is omitted', async () => {
  const runtime = makeTempRuntime();
  const home = makeHome('site-a');
  const secondSiteDir = path.join(home, 'nm-kube-config/alga-psa/talos', 'site-b');
  fs.mkdirSync(secondSiteDir, { recursive: true });
  fs.writeFileSync(path.join(secondSiteDir, 'kubeconfig'), 'fake');
  fs.writeFileSync(path.join(secondSiteDir, 'talosconfig'), 'fake');

  const result = await runCli(['status', '--asset-root', runtime], { HOME: home });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Multiple appliance sites found/i);
  assert.match(result.stderr, /--site-id/i);
});
