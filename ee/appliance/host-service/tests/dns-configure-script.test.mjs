import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dnsConfigurationFingerprint } from '../dns-config.mjs';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const helper = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'configure-k3s-dns.sh');

// Workloads the fake cluster reports per namespace. The helper must restart and
// verify them in the configured priority order.
const NAMESPACE_WORKLOADS = {
  'kube-system': 'deployment.apps/coredns\n',
  'local-path-storage': 'deployment.apps/local-path-provisioner\n',
  'flux-system': 'deployment.apps/source-controller\n',
  'alga-system': 'statefulset.apps/postgresql\n',
  'alga-appliance-control-plane': 'deployment.apps/appliance-control-plane\n'
};

function createRoot(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-dns-'));
  fs.mkdirSync(path.join(root, 'run', 'systemd', 'resolve'), { recursive: true });
  fs.mkdirSync(path.join(root, 'var', 'lib', 'alga-appliance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const resourcesDir = path.join(root, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  for (const [namespace, names] of Object.entries(options.workloads || NAMESPACE_WORKLOADS)) {
    fs.writeFileSync(path.join(resourcesDir, namespace), names);
  }
  fs.writeFileSync(path.join(root, 'k3s.yaml'), 'apiVersion: v1\n');
  // k3s start token: fakerestart increments it so an interrupted activation can
  // prove the restart actually happened.
  const tokenFile = path.join(root, 'k3s-token');
  fs.writeFileSync(tokenFile, options.token || '1\n');
  const rolloutFailMarker = path.join(root, 'rollout-fail');

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
  fs.writeFileSync(path.join(root, 'bin', 'fakekubectl'), `#!/usr/bin/env bash
echo "$*" >> "$FAKE_KUBECTL_LOG"
namespace=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-n" ]; then namespace="$argument"; fi
  previous="$argument"
done
case "$*" in
  *"get deploy,statefulset,daemonset -o name"*)
    if [ -n "$FAKE_LIST_FAIL_NAMESPACE" ] && [ "$namespace" = "$FAKE_LIST_FAIL_NAMESPACE" ]; then
      echo "Error from server (Forbidden): deployments.apps is forbidden: cannot list resource \"deployments\" in namespace \"$namespace\"" >&2
      exit 1
    fi
    if [ -n "$namespace" ] && [ -f "$FAKE_RESOURCES_DIR/$namespace" ]; then
      cat "$FAKE_RESOURCES_DIR/$namespace"
    else
      echo "Error from server (NotFound): namespaces \"$namespace\" not found" >&2
      exit 1
    fi
    ;;
  *"get pods -o json"*) echo '{"items":[]}' ;;
  *"rollout status"*)
    if [ -f "$FAKE_ROLLOUT_FAIL_MARKER" ]; then echo "rollout did not finish" >&2; exit 1; fi
    ;;
esac
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin', 'fakerestart'), `#!/usr/bin/env bash
echo restart >> "$FAKE_RESTART_LOG"
current="$(cat "$FAKE_TOKEN_FILE" 2>/dev/null || echo 0)"
echo $((current + 1)) > "$FAKE_TOKEN_FILE"
exit 0
`, { mode: 0o755 });

  return { root, kubectlLog, restartLog, tokenFile, rolloutFailMarker, resourcesDir };
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
      // No k3s on the test host: the helper must never consult systemd.
      ALGA_APPLIANCE_DNS_K3S_ACTIVE_COMMAND: 'false',
      ALGA_APPLIANCE_DNS_K3S_START_COMMAND: `cat ${harness.tokenFile}`,
      ALGA_APPLIANCE_DNS_API_TIMEOUT_SECONDS: '10',
      ALGA_APPLIANCE_DNS_ROLLOUT_TIMEOUT_SECONDS: '5',
      FAKE_KUBECTL_LOG: harness.kubectlLog,
      FAKE_RESTART_LOG: harness.restartLog,
      FAKE_RESOURCES_DIR: harness.resourcesDir,
      FAKE_ROLLOUT_FAIL_MARKER: harness.rolloutFailMarker,
      FAKE_TOKEN_FILE: harness.tokenFile,
      ...extraEnv
    }
  });
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readActivation(harness) {
  return JSON.parse(read(harness.root, 'var/lib/alga-appliance/dns-activation.json'));
}

function writeActivation(harness, value) {
  fs.writeFileSync(
    path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json'),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

function restartCount(harness) {
  return fs.readFileSync(harness.restartLog, 'utf8').split('\n').filter(Boolean).length;
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

test('IPv6 upstreams are canonicalized and deduplicated while stubs are rejected', () => {
  const harness = createRoot({
    systemdResolv: 'nameserver 2001:db8::53\nnameserver ::1\nnameserver 0:0:0:0:0:0:0:1\nnameserver 2001:0db8:0:0:0:0:0:0053\n'
  });
  const result = runHelper(harness, ['--no-activate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), 'nameserver 2001:db8::53\n');
});

test('empty custom servers fail explicitly instead of silently falling back to system DNS', () => {
  const harness = createRoot({
    systemdResolv: 'nameserver 192.0.2.53\n',
    setupInputs: { dnsMode: 'custom', dnsServers: '' }
  });
  const result = runHelper(harness, ['--no-activate']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no usable upstream resolver/);
  assert.equal(fs.existsSync(path.join(harness.root, 'etc/rancher/k3s/resolv.conf')), false);
});

test('invalid setup-inputs JSON fails explicitly and writes nothing', () => {
  const harness = createRoot({
    systemdResolv: 'nameserver 192.0.2.53\n',
    setupInputs: '{ not valid json'
  });
  const result = runHelper(harness, ['--no-activate']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not valid JSON/);
  assert.equal(fs.existsSync(path.join(harness.root, 'etc/rancher/k3s/resolv.conf')), false);
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

test('activation restarts k3s once, recreates workloads in priority order, and records the fingerprint', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  const first = runHelper(harness, ['--activate']);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(restartCount(harness), 1);

  const restarts = fs.readFileSync(harness.kubectlLog, 'utf8').split('\n').filter((line) => line.includes('rollout restart'));
  assert.ok(restarts.length >= 4, `expected several rollout restarts, got ${restarts.length}`);
  assert.match(restarts[0], /coredns/);
  assert.match(restarts.at(-1), /appliance-control-plane/);

  const activation = readActivation(harness);
  assert.match(activation.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(activation.stage, 'active');
  // The activation carries the setup-inputs fingerprint the control plane's
  // dns-config.mjs computes, which is what setup admission compares against.
  assert.equal(activation.configFingerprint, dnsConfigurationFingerprint({ dnsMode: 'system' }));
  // The control-plane host-service reads this file as UID 10001 from the state
  // hostPath; a root-only 0600 file would leave activation permanently pending.
  const activationMode = fs.statSync(path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json')).mode & 0o777;
  assert.equal(activationMode, 0o644, `activation record must be world-readable, got 0o${activationMode.toString(8)}`);

  const second = runHelper(harness, ['--activate']);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /already active/);
  assert.equal(restartCount(harness), 1);
});

test('a pending activation (matching files, no activation record) resumes without rewriting files', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  assert.equal(runHelper(harness, ['--no-activate']).status, 0);
  assert.equal(fs.existsSync(path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json')), false);

  const resumed = runHelper(harness, ['--activate']);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /already match the desired configuration/);
  assert.equal(restartCount(harness), 1);
  assert.equal(fs.existsSync(path.join(harness.root, 'var/lib/alga-appliance/dns-activation.json')), true);
});

test('--initial writes the files and records activation without restarting k3s', () => {
  const harness = createRoot({ systemdResolv: 'search customer.example\nnameserver 192.0.2.53\n' });
  const result = runHelper(harness, ['--initial']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(restartCount(harness), 0);
  assert.equal(read(harness.root, 'etc/rancher/k3s/resolv.conf'), 'nameserver 192.0.2.53\n');
  const activation = readActivation(harness);
  assert.equal(activation.stage, 'active');

  // The first running reconcile must not restart k3s just to re-apply what the
  // fresh boot already passed to kubelet.
  const later = runHelper(harness, ['--activate']);
  assert.equal(later.status, 0, later.stderr || later.stdout);
  assert.match(later.stdout, /already active/);
  assert.equal(restartCount(harness), 0);
});

test('--initial falls back to activation when k3s is already running', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  const result = runHelper(harness, ['--initial'], { ALGA_APPLIANCE_DNS_K3S_ACTIVE_COMMAND: 'true' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /already running; --initial cannot record activation/);
  assert.equal(restartCount(harness), 1);
  assert.equal(readActivation(harness).stage, 'active');
});

test('interrupted activation resumes rollouts without a second k3s restart', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  assert.equal(runHelper(harness, ['--activate']).status, 0);
  assert.equal(restartCount(harness), 1);
  const activation = readActivation(harness);

  // The control plane was replaced mid-rollout: the restart is verified (the
  // token moved) but activation was never recorded.
  writeActivation(harness, {
    ...activation,
    stage: 'rolling-out',
    restartFrom: '1',
    startedAt: activation.startedAt,
    updatedAt: activation.updatedAt,
    finishedAt: null
  });

  const resumed = runHelper(harness, ['--activate']);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /Resuming a pending DNS activation/);
  assert.equal(restartCount(harness), 1);
  const after = readActivation(harness);
  assert.equal(after.stage, 'active');
  assert.equal(after.restartFrom, '1', 'resume must keep the pre-restart token as restart evidence');
  assert.equal(after.restartToken, '2');
});

test('a failed rollout is recoverable without restarting k3s again', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  fs.writeFileSync(harness.rolloutFailMarker, 'fail');

  const failed = runHelper(harness, ['--activate']);
  assert.notEqual(failed.status, 0);
  assert.equal(restartCount(harness), 1);
  const activation = readActivation(harness);
  assert.equal(activation.stage, 'failed');
  assert.match(activation.error, /rollout/i);

  fs.rmSync(harness.rolloutFailMarker);
  const recovered = runHelper(harness, ['--activate']);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.match(recovered.stdout, /Resuming a pending DNS activation/);
  assert.equal(restartCount(harness), 1, 'recovery must not restart k3s a second time');
  assert.equal(readActivation(harness).stage, 'active');
});

test('rollout readiness failure is recorded as a durable failure', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  fs.writeFileSync(harness.rolloutFailMarker, 'fail');
  const result = runHelper(harness, ['--activate']);
  assert.notEqual(result.status, 0);
  const activation = readActivation(harness);
  assert.equal(activation.stage, 'failed');
  assert.match(activation.error, /rollout/i);
});

test('repeated rollout failures preserve restart evidence and never restart k3s again', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  fs.writeFileSync(harness.rolloutFailMarker, 'fail');

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = runHelper(harness, ['--activate']);
    assert.notEqual(result.status, 0, `attempt ${attempt} should fail`);
    assert.equal(restartCount(harness), 1, `attempt ${attempt} must not restart k3s again`);
    const activation = readActivation(harness);
    assert.equal(activation.stage, 'failed');
    // restartFrom must survive every atomic rewrite; the previous implementation
    // read it from the new temp file and lost it, so the third attempt restarted.
    assert.equal(activation.restartFrom, '1', `attempt ${attempt} must keep restartFrom`);
  }

  fs.rmSync(harness.rolloutFailMarker);
  const recovered = runHelper(harness, ['--activate']);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.match(recovered.stdout, /Resuming a pending DNS activation/);
  assert.equal(restartCount(harness), 1, 'recovery must not restart k3s again');
  const after = readActivation(harness);
  assert.equal(after.stage, 'active');
  assert.equal(after.restartFrom, '1');
});

test('a workload discovery error aborts activation instead of recording active', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  const result = runHelper(harness, ['--activate'], { FAKE_LIST_FAIL_NAMESPACE: 'flux-system' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not list workloads in flux-system/);
  const activation = readActivation(harness);
  assert.equal(activation.stage, 'failed');
  assert.match(activation.error, /rollout/i);
});

test('a namespace that does not exist yet is treated as empty, not a discovery failure', () => {
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n' });
  const result = runHelper(harness, ['--activate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Namespace msp is not present yet/);
  assert.equal(readActivation(harness).stage, 'active');
});

test('activation records the requested fingerprint and refuses a mismatched submission', () => {
  const inputs = { dnsMode: 'custom', dnsServers: '203.0.113.10, 203.0.113.11' };
  const harness = createRoot({ systemdResolv: 'nameserver 192.0.2.53\n', setupInputs: inputs });
  const expected = dnsConfigurationFingerprint(inputs);

  const activated = runHelper(harness, ['--activate'], { ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: expected });
  assert.equal(activated.status, 0, activated.stderr || activated.stdout);
  const activation = readActivation(harness);
  assert.equal(activation.stage, 'active');
  assert.equal(activation.configFingerprint, expected);
  assert.equal(restartCount(harness), 1);

  // The persisted inputs no longer resolve to the submitted fingerprint: the
  // helper must refuse rather than label a different configuration as active.
  const mismatched = runHelper(harness, ['--activate'], { ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: 'd'.repeat(64) });
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /no longer matches the persisted setup inputs/);
  const refused = readActivation(harness);
  assert.equal(refused.stage, 'failed');
  assert.match(refused.error, /changed before activation/);
  assert.equal(restartCount(harness), 1, 'a refused submission must not restart k3s');
});

test('a refused old submission cannot lend restart evidence to a new resolver', () => {
  const oldInputs = { dnsMode: 'custom', dnsServers: '203.0.113.10' };
  const newInputs = { dnsMode: 'custom', dnsServers: '203.0.113.11' };
  const harness = createRoot({ setupInputs: oldInputs });
  const oldFingerprint = dnsConfigurationFingerprint(oldInputs);
  const newFingerprint = dnsConfigurationFingerprint(newInputs);

  const initial = runHelper(harness, ['--activate'], { ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: oldFingerprint });
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);
  assert.equal(restartCount(harness), 1);
  assert.equal(readActivation(harness).restartFrom, '1');

  fs.writeFileSync(path.join(harness.root, 'var/lib/alga-appliance/setup-inputs.json'), JSON.stringify(newInputs));
  const refused = runHelper(harness, ['--activate'], { ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: oldFingerprint });
  assert.notEqual(refused.status, 0);
  const failed = readActivation(harness);
  assert.equal(failed.stage, 'failed');
  assert.equal(failed.restartFrom, null, 'old restart evidence must be cleared for new resolver bytes');
  assert.equal(failed.restartToken, null);
  assert.equal(failed.configFingerprint, newFingerprint);
  assert.equal(restartCount(harness), 1);

  const reconciled = runHelper(harness, ['--activate'], { ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: newFingerprint });
  assert.equal(reconciled.status, 0, reconciled.stderr || reconciled.stdout);
  assert.equal(restartCount(harness), 2, 'new resolver bytes require their own k3s restart');
  const active = readActivation(harness);
  assert.equal(active.stage, 'active');
  assert.equal(active.configFingerprint, newFingerprint);
  assert.equal(active.restartFrom, '2');
  assert.equal(active.restartToken, '3');
});
