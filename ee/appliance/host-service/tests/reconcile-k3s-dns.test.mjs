import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const launcher = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'reconcile-k3s-dns.sh');
const IMAGE = `ghcr.io/nine-minds/alga-appliance-control-plane@sha256:${'a'.repeat(64)}`;

function renderManifest(extraEnv = {}) {
  const result = spawnSync('bash', [launcher, '--dry-run', '--kubeconfig', '/tmp/k3s.yaml'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ALGA_APPLIANCE_CONTROL_PLANE_IMAGE: IMAGE, ...extraEnv }
  });
  return result;
}

test('the DNS reconcile Job runs privileged in the support plane with the host helper', () => {
  const result = renderManifest();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = result.stdout;

  assert.match(manifest, /kind: Job/);
  assert.match(manifest, /namespace: alga-appliance-support/);
  assert.doesNotMatch(manifest, /namespace: alga-appliance-control-plane/);
  assert.match(manifest, /serviceAccountName: default/);
  assert.match(manifest, /hostPID: true/);
  assert.match(manifest, /privileged: true/);
  // The image defaults to USER 10001; host configuration and activation must run
  // as root. It has to be explicit on the pod and the reconcile container.
  const rootRunCount = (manifest.match(/runAsUser: 0/g) || []).length;
  const rootGroupCount = (manifest.match(/runAsGroup: 0/g) || []).length;
  assert.ok(rootRunCount >= 2, `expected pod+container runAsUser 0, got ${rootRunCount}`);
  assert.ok(rootGroupCount >= 2, `expected pod+container runAsGroup 0, got ${rootGroupCount}`);
  assert.match(manifest, new RegExp(`image: ${IMAGE.replace(/[.@/]/g, (m) => `\\${m}`)}`));
  assert.match(manifest, /imagePullPolicy: IfNotPresent/);
  assert.match(manifest, /configure-k3s-dns\.sh/);
  assert.match(manifest, /--activate/);
  // Host activation is owned by a transient systemd service so it survives the
  // Job, the control plane and the k3s restart it triggers.
  assert.match(manifest, /systemd-run/);
  assert.match(manifest, /alga-appliance-dns-activate/);
  assert.match(manifest, /--setenv="ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT=/);
});

test('the requested DNS configuration fingerprint is forwarded to the host unit', () => {
  const fingerprint = 'a'.repeat(64);
  const result = renderManifest({ ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: fingerprint });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const job = YAML.parse(result.stdout);
  const command = job.spec.template.spec.containers[0].command[2];
  assert.match(command, new RegExp(`--setenv="ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT=${fingerprint}"`));
});

test('a malformed fingerprint is rejected before the Job is staged', () => {
  const result = renderManifest({ ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: 'not-a-fingerprint' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /64-character hex sha256/);
});

test('the dry-run manifest parses as valid YAML and runs as root with the running image', () => {
  const result = renderManifest();
  assert.equal(result.status, 0, result.stderr || result.stdout);

  // Parsing (not a text match) is the contract kubectl apply depends on; nested
  // heredocs unindented at column zero previously made this invalid YAML.
  const job = YAML.parse(result.stdout);
  assert.equal(job.apiVersion, 'batch/v1');
  assert.equal(job.kind, 'Job');
  assert.equal(job.metadata.name, 'alga-appliance-dns-reconcile');
  assert.equal(job.metadata.namespace, 'alga-appliance-support');

  const template = job.spec.template.spec;
  assert.equal(template.hostPID, true);
  assert.equal(template.hostNetwork, true);
  // The control-plane image defaults to USER 10001; host configuration and a
  // k3s restart require root on both the pod and the container.
  assert.equal(template.securityContext.runAsUser, 0);
  assert.equal(template.securityContext.runAsGroup, 0);

  const container = template.containers[0];
  assert.equal(container.image, IMAGE);
  assert.equal(container.imagePullPolicy, 'IfNotPresent');
  assert.equal(container.securityContext.privileged, true);
  assert.equal(container.securityContext.runAsUser, 0);
  assert.equal(container.securityContext.runAsGroup, 0);

  // The command stages only the fixed helper to the host and launches the
  // host-owned unit; it is not an arbitrary command endpoint.
  const command = container.command[2];
  assert.match(command, /configure-k3s-dns\.sh/);
  assert.match(command, /--activate/);
  assert.match(command, /systemd-run/);
  assert.match(command, /alga-appliance-dns-activate/);
  assert.doesNotMatch(command, /--host-root/);
  // Host commands must switch to the host root filesystem, not just the host
  // namespaces; otherwise systemd/sharded host tools are unreachable.
  assert.match(command, /--root=\/host\b/);
  assert.match(command, /--wdns=\//);

  // The helper writes the activation record from host root; assert the mount is
  // present so the record lands on the shared state path.
  assert.ok(template.volumes.some((volume) => volume.name === 'host-root' && volume.hostPath?.path === '/'));
});

test('the Job namespace and service account are overridable for tests and future layouts', () => {
  const result = renderManifest({
    ALGA_APPLIANCE_DNS_JOB_NAMESPACE: 'custom-dns',
    ALGA_APPLIANCE_DNS_JOB_SA: 'custom-sa'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /namespace: custom-dns/);
  assert.match(result.stdout, /serviceAccountName: custom-sa/);
});

// A YAML-parse assertion cannot catch a command that parses but cannot run. This
// builds the real command string and executes it against stub host tools so the
// `command -v`-as-a-builtin bug (and any future staging regression) fails here.
//
// The harness also models the container-root defect: the container's `systemd-run`
// is a decoy that records and fails, while only the host root's `systemd-run`
// succeeds. A Job that enters the host namespaces without switching root reaches
// the decoy and fails, so the regression test below catches the missing
// `--root`/`--wdns` switch.
function makeExecHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-dns-job-'));
  const fakeBin = path.join(dir, 'bin');
  fs.mkdirSync(fakeBin);
  const helperSource = path.join(dir, 'configure-k3s-dns.sh');
  fs.writeFileSync(helperSource, '#!/usr/bin/env bash\necho "helper $*"\n', { mode: 0o755 });
  const hostRoot = path.join(dir, 'host');
  fs.mkdirSync(path.join(hostRoot, 'usr', 'bin'), { recursive: true });
  const stageDir = '/var/lib/alga-appliance/dns';
  const systemdRunLog = path.join(dir, 'host-systemd-run.log');
  const containerSystemdRunLog = path.join(dir, 'container-systemd-run.log');
  const nsenterLog = path.join(dir, 'nsenter.log');

  // Forward nsenter calls to the command after `--`, emulating the host root
  // switch: `--root=<dir>` prepends that root's /usr/bin to PATH (the real
  // nsenter opens the directory before setns and chroots into it).
  fs.writeFileSync(path.join(fakeBin, 'nsenter'), `#!/usr/bin/env bash
echo "$*" >> "$NSENTER_LOG"
root=""
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
  case "$1" in
    --root=*) root="\${1#--root=}" ;;
  esac
  shift
done
[ "\${1:-}" = "--" ] && shift
if [ -n "$root" ] && [ -d "$root" ]; then
  export PATH="$root/usr/bin:$PATH"
fi
exec "$@"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'systemctl'), `#!/usr/bin/env bash
exit 1
`, { mode: 0o755 });
  // The container image root has no working host tooling: without a root switch
  // this decoy is what a systemd-run call would hit.
  fs.writeFileSync(path.join(fakeBin, 'systemd-run'), `#!/usr/bin/env bash
echo "$*" >> "$CONTAINER_SYSTEMD_RUN_LOG"
echo "systemd-run: command not usable from the container root" >&2
exit 1
`, { mode: 0o755 });
  // The host root's real tooling.
  fs.writeFileSync(path.join(hostRoot, 'usr', 'bin', 'systemd-run'), `#!/usr/bin/env bash
echo "$*" >> "$SYSTEMD_RUN_LOG"
exit 0
`, { mode: 0o755 });

  return { dir, fakeBin, helperSource, hostRoot, stageDir, systemdRunLog, containerSystemdRunLog, nsenterLog };
}

test('the generated container command executes and launches the host unit', () => {
  const harness = makeExecHarness();
  const fingerprint = 'b'.repeat(64);
  const result = renderManifest({
    ALGA_APPLIANCE_DNS_JOB_HOST_ROOT: harness.hostRoot,
    ALGA_APPLIANCE_DNS_HELPER_SOURCE: harness.helperSource,
    ALGA_APPLIANCE_DNS_STAGE_DIR: harness.stageDir,
    ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: fingerprint
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const job = YAML.parse(result.stdout);
  const command = job.spec.template.spec.containers[0].command[2];

  const execution = spawnSync('bash', ['-c', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${harness.fakeBin}:${process.env.PATH}`,
      SYSTEMD_RUN_LOG: harness.systemdRunLog,
      CONTAINER_SYSTEMD_RUN_LOG: harness.containerSystemdRunLog,
      NSENTER_LOG: harness.nsenterLog
    }
  });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  assert.match(execution.stdout, /Launched host-owned DNS activation service/);

  const systemdRun = fs.readFileSync(harness.systemdRunLog, 'utf8');
  assert.match(systemdRun, /--unit=alga-appliance-dns-activate/);
  assert.match(systemdRun, /configure-k3s-dns\.sh/);
  assert.match(systemdRun, /--activate/);
  assert.match(systemdRun, new RegExp(`ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT=${fingerprint}`));

  // The fixed helper and the host kubectl wrapper landed on the staged host root.
  const stagedDir = path.join(harness.hostRoot, harness.stageDir);
  assert.equal(fs.existsSync(path.join(stagedDir, 'configure-k3s-dns.sh')), true);
  assert.equal(fs.existsSync(path.join(stagedDir, 'kubectl')), true);
});

test('every host nsenter switches to the host root and reaches the host systemd-run', () => {
  const harness = makeExecHarness();
  const result = renderManifest({
    ALGA_APPLIANCE_DNS_JOB_HOST_ROOT: harness.hostRoot,
    ALGA_APPLIANCE_DNS_HELPER_SOURCE: harness.helperSource,
    ALGA_APPLIANCE_DNS_STAGE_DIR: harness.stageDir,
    ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT: 'c'.repeat(64)
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const job = YAML.parse(result.stdout);
  const command = job.spec.template.spec.containers[0].command[2];
  const execution = spawnSync('bash', ['-c', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${harness.fakeBin}:${process.env.PATH}`,
      SYSTEMD_RUN_LOG: harness.systemdRunLog,
      CONTAINER_SYSTEMD_RUN_LOG: harness.containerSystemdRunLog,
      NSENTER_LOG: harness.nsenterLog
    }
  });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);

  // Every nsenter invocation must name the host root and the rooted workdir.
  const nsenterLog = fs.readFileSync(harness.nsenterLog, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(nsenterLog.length >= 3, `expected the systemd-run path to nsenter, got ${nsenterLog.length}`);
  for (const invocation of nsenterLog) {
    assert.match(invocation, /--root=/, `nsenter invocation missing host root: ${invocation}`);
    assert.match(invocation, /--wdns=\//, `nsenter invocation missing rooted workdir: ${invocation}`);
  }

  // The activation reached the host's systemd-run, not the container-root decoy.
  assert.equal(fs.existsSync(harness.containerSystemdRunLog), false, 'activation ran against container-root systemd-run');
  const hostInvocation = nsenterLog.find((line) => /systemd-run/.test(line));
  assert.ok(hostInvocation, 'no nsenter call reached systemd-run');
  assert.match(fs.readFileSync(harness.systemdRunLog, 'utf8'), /--unit=alga-appliance-dns-activate/);
});
