import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const helper = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'configure-k3s-dns.sh');

function createRoot(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-dns-'));
  fs.mkdirSync(path.join(root, 'run', 'systemd', 'resolve'), { recursive: true });
  fs.mkdirSync(path.join(root, 'var', 'lib', 'alga-appliance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'k3s.yaml'), 'apiVersion: v1\n');

  if (options.setupInputs !== undefined) {
    fs.writeFileSync(
      path.join(root, 'var', 'lib', 'alga-appliance', 'setup-inputs.json'),
      typeof options.setupInputs === 'string' ? options.setupInputs : JSON.stringify(options.setupInputs)
    );
  }
  if (options.systemdResolv !== undefined) {
    fs.writeFileSync(path.join(root, 'run', 'systemd', 'resolve', 'resolv.conf'), options.systemdResolv);
  }
  if (options.hostResolv !== undefined) {
    fs.writeFileSync(path.join(root, 'etc', 'resolv.conf'), options.hostResolv);
  }

  const kubectlLog = path.join(root, 'kubectl.log');
  const restartLog = path.join(root, 'restart.log');
  fs.writeFileSync(kubectlLog, '');
  fs.writeFileSync(restartLog, '');
  fs.writeFileSync(path.join(root, 'bin', 'fakekubectl'), `#!/usr/bin/env bash\necho "$*" >> "$FAKE_KUBECTL_LOG"\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin', 'fakerestart'), `#!/usr/bin/env bash\necho restart >> "$FAKE_RESTART_LOG"\nexit 0\n`, { mode: 0o755 });

  return { root, kubectlLog, restartLog };
}

function runHelper(harness, args = [], extraEnv = {}) {
  return spawnSync('bash', [helper, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ALGA_APPLIANCE_DNS_ROOT: harness.root,
      ALGA_APPLIANCE_KUBECONFIG: path.join(harness.root, 'k3s.yaml'),
      ALGA_APPLIANCE_KUBECTL: path.join(harness.root, 'bin', 'fakekubectl'),
      ALGA_APPLIANCE_DNS_RESTART_COMMAND: path.join(harness.root, 'bin', 'fakerestart'),
      ALGA_APPLIANCE_DNS_API_TIMEOUT_SECONDS: '10',
      ...(harness.kubectlLog ? { FAKE_KUBECTL_LOG: harness.kubectlLog } : {}),
      ...(harness.restartLog ? { FAKE_RESTART_LOG: harness.restartLog } : {}),
      ...extraEnv
    }
  });
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('system mode writes a search-free resolver and the resolv-conf drop-in, dropping stubs/loopback', () => {
  const harness = createRoot({
    systemdResolv: 'search customer.example wildcard.test\noptions ndots:5\nnameserver 192.0.2.53\nnameserver 127.0.0.53\nnameserver ::1\nnameserver 192.0.2.54\n'
  });
  const result = runHelper(harness, ['--no-activate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const resolv = read(harness.root, 'etc/rancher/k3s/resolv.conf');
  assert.equal(resolv, 'nameserver 192.0.2.53\nnameserver 192.0.2.54\n');
  assert.doesNotMatch(resolv, /search|wildcard|127\.0\.0\.53|::1/);

  const dropin = read(harness.root, 'etc/rancher/k3s/config.yaml.d/30-alga-dns.yaml');
  assert.equal(dropin, 'resolv-conf: /etc/rancher/k3s/resolv.conf\n');
});

test('custom mode uses validated operator servers, deduplicated in order', () => {
  const harness = createRoot({
    systemdResolv: 'nameserver 192.0.2.53\n',
    setupInputs: { dnsMode: 'custom', dnsServers: '203.0.113.10, 203.0.113.11,203.0.113.10' }
  });
  const result = runHelper(harness, ['--no-activate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), 'nameserver 203.0.113.10\nnameserver 203.0.113.11\n');
});

test('invalid custom input fails explicitly and retains the last valid files', () => {
  const harness = createRoot({
    systemdResolv: 'nameserver 192.0.2.53\n',
    setupInputs: { dnsMode: 'custom', dnsServers: '203.0.113.10' }
  });
  assert.equal(runHelper(harness, ['--no-activate']).status, 0);
  const previous = read(harness.root, 'etc/rancher/k3s/resolv.conf');

  fs.writeFileSync(
    path.join(harness.root, 'var', 'lib', 'alga-appliance', 'setup-inputs.json'),
    JSON.stringify({ dnsMode: 'custom', dnsServers: 'not-an-ip' })
  );
  const result = runHelper(harness, ['--no-activate']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a usable literal address/);
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), previous);
});

test('falls back to the host resolver file when systemd-resolved output is absent, keeping only nameservers', () => {
  const harness = createRoot({ hostResolv: 'search customer.example\nnameserver 198.51.100.7\n' });
  const result = runHelper(harness, ['--no-activate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), 'nameserver 198.51.100.7\n');
});

test('a changed upstream refreshes both files; an unchanged re-run is a no-op', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  assert.equal(runHelper(harness, ['--no-activate']).status, 0);
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), 'nameserver 192.0.2.53\n');

  fs.writeFileSync(path.join(harness.root, 'run', 'systemd', 'resolve', 'resolv.conf'), 'nameserver 192.0.2.99\n');
  const changed = runHelper(harness, ['--no-activate']);
  assert.equal(changed.status, 0);
  assert.match(changed.stdout, /Wrote/);
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), 'nameserver 192.0.2.99\n');

  const noop = runHelper(harness, ['--no-activate']);
  assert.equal(noop.status, 0);
  assert.match(noop.stdout, /already match/);
});

test('--dry-run writes nothing', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  const result = runHelper(harness, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /no search domains/);
  assert.equal(fs.existsSync(path.join(harness.root, 'etc/rancher/k3s/resolv.conf')), false);
});

test('activation restarts k3s once, recreates pods in priority order, and records the fingerprint', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  const first = runHelper(harness, ['--activate']);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(fs.readFileSync(harness.restartLog, 'utf8').trim(), 'restart');

  const restarts = fs.readFileSync(harness.kubectlLog, 'utf8').split('\n').filter((line) => line.includes('rollout restart'));
  assert.ok(restarts.length >= 4, `expected several rollout restarts, got ${restarts.length}`);
  assert.match(restarts[0], /coredns/);
  assert.match(restarts.at(-1), /appliance-control-plane/);

  const activation = JSON.parse(read(harness.root, 'var/lib/alga-appliance/dns-activation.json'));
  assert.match(activation.fingerprint, /^[0-9a-f]{64}$/);

  const second = runHelper(harness, ['--activate']);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /already active/);
  assert.equal(fs.readFileSync(harness.restartLog, 'utf8').trim(), 'restart');
});

test('a pending activation (matching files, no activation record) resumes without rewriting files', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  assert.equal(runHelper(harness, ['--no-activate']).status, 0);
  assert.equal(fs.existsSync(path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json')), false);

  const resumed = runHelper(harness, ['--activate']);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /already match the desired configuration/);
  assert.equal(fs.readFileSync(harness.restartLog, 'utf8').trim(), 'restart');
  assert.equal(fs.existsSync(path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json')), true);
});

test('--initial writes the files and records activation without restarting k3s', () => {
  const harness = createRoot({ systemdResolv: 'search customer.example\nnameserver 192.0.2.53\n' });
  const result = runHelper(harness, ['--initial']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(harness.restartLog, 'utf8'), '');
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), 'nameserver 192.0.2.53\n');
  const activation = JSON.parse(read(harness.root, 'var/lib/alga-appliance/dns-activation.json'));
  assert.equal(activation.stage, 'active');

  // The first running reconcile must not restart k3s just to re-apply what the
  // fresh boot already passed to kubelet.
  const later = runHelper(harness, ['--activate']);
  assert.equal(later.status, 0, later.stderr || later.stdout);
  assert.match(later.stdout, /already active/);
  assert.equal(fs.readFileSync(harness.restartLog, 'utf8'), '');
});

test('a prior pending record resumes the rollout without a second k3s restart', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  assert.equal(runHelper(harness, ['--activate']).status, 0);
  assert.equal(fs.readFileSync(harness.restartLog, 'utf8').trim(), 'restart');

  // Simulate the process being killed by the restart before it recorded
  // activation: the pending record remains, the activation record does not.
  fs.rmSync(path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json'));
  const resumed = runHelper(harness, ['--activate']);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /Resuming a pending DNS activation/);
  assert.equal(fs.readFileSync(harness.restartLog, 'utf8').trim(), 'restart');
  assert.equal(fs.existsSync(path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json')), true);
});
