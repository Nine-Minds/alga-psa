import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { runRepairRelease } from '../lib/lifecycle.mjs';

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

function makeTempRuntime({ resetCheck = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-operator-runtime-'));
  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'collect-support-bundle.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(scriptsDir, 'repair-release.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

  const resetScript = resetCheck
    ? '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$HOME/reset-args.txt"\nexit 0\n'
    : '#!/usr/bin/env bash\nexit 0\n';
  fs.writeFileSync(path.join(scriptsDir, 'reset-appliance-data.sh'), resetScript, { mode: 0o755 });
  return root;
}

function makeHome(siteId = 'site-a') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-operator-home-'));
  const siteDir = path.join(home, '.alga-psa-appliance', siteId);
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

test('CLI reset enforces force flag and invokes reset helper when confirmed', async () => {
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

test('CLI does not expose the removed bootstrap or upgrade commands', async () => {
  const runtime = makeTempRuntime();
  const home = makeHome();

  const bootstrap = await runCli(['bootstrap', '--asset-root', runtime, '--site-id', 'site-a'], { HOME: home });
  assert.equal(bootstrap.code, 1);
  assert.match(bootstrap.stderr, /Unknown command: bootstrap/);

  const upgrade = await runCli(['upgrade', '--asset-root', runtime, '--site-id', 'site-a'], { HOME: home });
  assert.equal(upgrade.code, 1);
  assert.match(upgrade.stderr, /Unknown command: upgrade/);
});

test('CLI fails fast when multiple site configs exist and --site-id is omitted', async () => {
  const runtime = makeTempRuntime();
  const home = makeHome('site-a');
  const secondSiteDir = path.join(home, '.alga-psa-appliance', 'site-b');
  fs.mkdirSync(secondSiteDir, { recursive: true });
  fs.writeFileSync(path.join(secondSiteDir, 'kubeconfig'), 'fake');
  fs.writeFileSync(path.join(secondSiteDir, 'talosconfig'), 'fake');

  const result = await runCli(['status', '--asset-root', runtime], { HOME: home });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Multiple appliance sites found/i);
  assert.match(result.stderr, /--site-id/i);
});
