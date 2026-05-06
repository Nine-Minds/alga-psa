import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parse, parseAllDocuments } from 'yaml';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const buildScript = path.join(repoRoot, 'ee', 'appliance', 'ubuntu-iso', 'scripts', 'build-ubuntu-appliance-iso.sh');
const userDataPath = path.join(repoRoot, 'ee', 'appliance', 'ubuntu-iso', 'config', 'nocloud', 'user-data');
const overlayRoot = path.join(repoRoot, 'ee', 'appliance', 'ubuntu-iso', 'overlay', 'opt', 'alga-appliance');
const storageManifestPath = path.join(repoRoot, 'ee', 'appliance', 'manifests', 'local-path-storage.yaml');
const temporalChartPath = path.join(repoRoot, 'ee', 'helm', 'temporal');
const temporalWorkerChartPath = path.join(repoRoot, 'ee', 'helm', 'temporal-worker');
const temporalProfileValuesPath = path.join(repoRoot, 'ee', 'appliance', 'flux', 'profiles', 'talos-single-node', 'values', 'temporal.talos-single-node.yaml');
const temporalWorkerProfileValuesPath = path.join(repoRoot, 'ee', 'appliance', 'flux', 'profiles', 'talos-single-node', 'values', 'temporal-worker.talos-single-node.yaml');
const fluxReleaseDir = path.join(repoRoot, 'ee', 'appliance', 'flux', 'base', 'releases');

function run(command, args, env = process.env) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', env });
}

function writeFakeXorriso(binDir, logFile, labelFile) {
  const fakeXorriso = path.join(binDir, 'xorriso');
  fs.writeFileSync(fakeXorriso, `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$FAKE_XORRISO_LOG"

if [[ "\${1:-}" == "-osirrox" ]]; then
  args=("$@")
  dest="\${args[$((\${#args[@]} - 1))]}"
  mkdir -p "$dest/boot/grub" "$dest/casper" "$dest/EFI/boot"
  cat > "$dest/boot/grub/grub.cfg" <<'CFG'
set timeout=30
menuentry "Try or Install Ubuntu Server" {
    set gfxpayload=keep
    linux /casper/vmlinuz ---
    initrd /casper/initrd
}
CFG
  cp "$dest/boot/grub/grub.cfg" "$dest/boot/grub/loopback.cfg"
  touch "$dest/casper/vmlinuz" "$dest/casper/initrd" "$dest/EFI/boot/bootx64.efi"
  exit 0
fi

if [[ "\${1:-}" == "-as" && "\${2:-}" == "mkisofs" ]]; then
  args=("$@")
  output=""
  label=""
  for ((i = 0; i < \${#args[@]}; i++)); do
    case "\${args[$i]}" in
      -o)
        output="\${args[$((i + 1))]}"
        ;;
      -V)
        label="\${args[$((i + 1))]}"
        ;;
    esac
  done
  printf '%s\\n' "$label" > "$FAKE_XORRISO_LABEL"
  printf 'fake iso\\n' > "$output"
  exit 0
fi

exit 2
`);
  fs.chmodSync(fakeXorriso, 0o755);
}

function helmTemplate(chartPath, valuesPath) {
  const args = ['template', 'test-release', chartPath, '--namespace', 'msp'];
  if (valuesPath) {
    args.push('-f', valuesPath);
  }
  const result = run('helm', args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return parseAllDocuments(result.stdout).map((doc) => doc.toJSON()).filter(Boolean);
}

function runBuildWithFakeXorriso() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-ubuntu-iso-test-'));
  const tmpIso = path.join(tmp, 'base.iso');
  const binDir = path.join(tmp, 'bin');
  const workRoot = path.join(tmp, 'work');
  const outputRoot = path.join(tmp, 'output');
  const logFile = path.join(tmp, 'xorriso.log');
  const labelFile = path.join(tmp, 'xorriso-label.txt');
  const releaseVersion = `test-${Date.now()}`;

  fs.mkdirSync(binDir);
  fs.mkdirSync(workRoot);
  fs.mkdirSync(outputRoot);
  fs.writeFileSync(tmpIso, 'fake-iso-content');
  writeFakeXorriso(binDir, logFile, labelFile);

  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    FAKE_XORRISO_LOG: logFile,
    FAKE_XORRISO_LABEL: labelFile,
    ALGA_APPLIANCE_ISO_WORK_DIR: workRoot,
    ALGA_APPLIANCE_ISO_OUTPUT_DIR: outputRoot
  };

  const build = run('bash', [buildScript, '--base-iso', tmpIso, '--release-version', releaseVersion], env);
  assert.equal(build.status, 0, build.stderr || build.stdout);

  return { workRoot, outputRoot, releaseVersion, labelFile };
}

test('T001 build smoke: remastered ISO is branded and includes the offline appliance overlay', () => {
  const tmpIso = path.join(os.tmpdir(), `alga-ubuntu-base-${Date.now()}.iso`);
  const releaseVersion = `test-${Date.now()}`;
  fs.writeFileSync(tmpIso, 'fake-iso-content');

  const dryRun = run('bash', [buildScript, '--base-iso', tmpIso, '--release-version', releaseVersion, '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /layout validated/i);

  const build = runBuildWithFakeXorriso();

  assert.equal(fs.existsSync(path.join(overlayRoot, 'appliance')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'host-service')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'operator')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'scripts')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'manifests', 'local-path-storage.yaml')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'flux')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'releases', 'channels')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'status-ui', 'dist', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'status-ui', 'dist', 'setup', 'index.html')), true);

  const isoRoot = path.join(build.workRoot, 'iso-root');
  assert.equal(fs.readFileSync(path.join(isoRoot, '.disk', 'info'), 'utf8'), 'AlgaPSA Install\n');
  assert.equal(fs.readFileSync(build.labelFile, 'utf8'), 'ALGAPSA_INSTALL\n');
  assert.equal(fs.existsSync(path.join(isoRoot, 'alga-overlay', 'opt', 'alga-appliance', 'host-service')), true);
  assert.equal(fs.existsSync(path.join(isoRoot, 'alga-overlay', 'opt', 'alga-appliance', 'releases', 'channels')), true);

  const grubConfig = fs.readFileSync(path.join(isoRoot, 'boot', 'grub', 'grub.cfg'), 'utf8');
  assert.match(grubConfig, /menuentry "AlgaPSA Install"/);
  assert.match(grubConfig, /autoinstall ds=nocloud\\;s=\/cdrom\/nocloud\//);

  const isoOut = path.join(build.outputRoot, `alga-appliance-ubuntu-${build.releaseVersion}.iso`);
  const shaOut = `${isoOut}.sha256`;
  assert.equal(fs.existsSync(isoOut), true);
  assert.equal(fs.existsSync(shaOut), true);
});

test('T002 installer config sanity: network and storage remain user-confirmed before install actions', () => {
  const userData = parse(fs.readFileSync(userDataPath, 'utf8'));

  assert.deepEqual(userData.autoinstall['interactive-sections'], ['network', 'storage']);
  assert.equal(userData.autoinstall.storage.layout.name, 'direct');
  assert.equal(userData.autoinstall.storage.layout['sizing-policy'], 'all');
});

test('T003 storage manifest avoids k3s default local-path RBAC collisions and grants configmap access', () => {
  const docs = parseAllDocuments(fs.readFileSync(storageManifestPath, 'utf8')).map((doc) => doc.toJSON());
  const clusterRole = docs.find((doc) => doc?.kind === 'ClusterRole' && doc.metadata?.name === 'alga-local-path-provisioner-cluster-role');
  const clusterRoleBinding = docs.find((doc) => doc?.kind === 'ClusterRoleBinding' && doc.metadata?.name === 'alga-local-path-provisioner-cluster-bind');
  const namespacedRole = docs.find((doc) => doc?.kind === 'Role' && doc.metadata?.name === 'alga-local-path-provisioner-namespaced-role');
  const namespacedRoleBinding = docs.find((doc) => doc?.kind === 'RoleBinding' && doc.metadata?.name === 'alga-local-path-provisioner-namespaced-bind');

  assert.ok(clusterRole);
  assert.ok(clusterRoleBinding);
  assert.ok(namespacedRole);
  assert.ok(namespacedRoleBinding);
  assert.equal(docs.some((doc) => doc?.kind === 'ClusterRoleBinding' && doc.metadata?.name === 'local-path-provisioner-bind'), false);
  assert.equal(clusterRoleBinding.roleRef.name, 'alga-local-path-provisioner-cluster-role');
  assert.equal(namespacedRoleBinding.roleRef.name, 'alga-local-path-provisioner-namespaced-role');
  assert.ok(namespacedRole.rules.some((rule) => rule.resources.includes('configmaps') && rule.verbs.includes('get')));
  assert.ok(clusterRole.rules.some((rule) => rule.resources.includes('configmaps') && rule.verbs.includes('get')));
});

test('T004 Temporal chart waits for schema-safe startup and creates the default namespace with a Helm hook', () => {
  const docs = helmTemplate(temporalChartPath, temporalProfileValuesPath);
  const deployment = docs.find((doc) => doc.kind === 'Deployment' && doc.metadata?.name === 'test-release-temporal');
  const job = docs.find((doc) => doc.kind === 'Job' && doc.metadata?.name === 'test-release-temporal-namespace-init');

  assert.ok(deployment);
  assert.ok(job);
  const temporalContainer = deployment.spec.template.spec.containers.find((container) => container.name === 'temporal');
  const env = Object.fromEntries(temporalContainer.env.map((entry) => [entry.name, entry.value]));
  assert.equal(env.DEFAULT_NAMESPACE, 'default');
  assert.equal(env.SKIP_DEFAULT_NAMESPACE_CREATION, 'true');
  assert.equal(env.SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES, 'true');
  assert.equal(temporalContainer.livenessProbe.initialDelaySeconds, 300);
  assert.ok(temporalContainer.startupProbe.failureThreshold >= 60);

  assert.equal(job.metadata.annotations['helm.sh/hook'], 'post-install,post-upgrade');
  assert.match(job.spec.template.spec.containers[0].command.join('\n'), /temporal operator namespace create/);
});

test('T005 temporal-worker profile injects NEXTAUTH_SECRET from alga-core secrets', () => {
  const docs = helmTemplate(temporalWorkerChartPath, temporalWorkerProfileValuesPath);
  const deployment = docs.find((doc) => doc.kind === 'Deployment' && doc.metadata?.name === 'test-release-temporal-worker');
  assert.ok(deployment);

  const env = deployment.spec.template.spec.containers[0].env;
  const nextAuth = env.find((entry) => entry.name === 'NEXTAUTH_SECRET');
  assert.deepEqual(nextAuth.valueFrom.secretKeyRef, {
    name: 'alga-core-sebastian-secrets',
    key: 'NEXTAUTH_SECRET'
  });
});

test('T006 Flux HelmReleases retry transient single-node install stalls', () => {
  for (const file of fs.readdirSync(fluxReleaseDir).filter((name) => name.endsWith('.yaml'))) {
    const doc = parse(fs.readFileSync(path.join(fluxReleaseDir, file), 'utf8'));
    assert.ok(doc.spec.install.remediation.retries >= 1, `${file} install retries`);
    assert.ok(doc.spec.upgrade.remediation.retries >= 1, `${file} upgrade retries`);
  }
});

test('T007/T008 install flow sanity: payload copy and disk-first marker are present in generated installer inputs', () => {
  const userData = parse(fs.readFileSync(userDataPath, 'utf8'));
  const lateCommands = userData.autoinstall['late-commands'];
  const build = runBuildWithFakeXorriso();
  const grubConfig = fs.readFileSync(path.join(build.workRoot, 'iso-root', 'boot', 'grub', 'grub.cfg'), 'utf8');

  assert.ok(lateCommands.some((command) => command.includes('/cdrom/alga-overlay') && command.includes('/target/')));
  assert.ok(lateCommands.some((command) => command.includes('systemctl enable alga-appliance.service')));
  assert.ok(lateCommands.some((command) => command.includes('systemctl enable alga-appliance-console.service')));
  assert.ok(lateCommands.some((command) => command.includes('/target/etc/alga-appliance/booted-from-disk')));
  assert.ok(lateCommands.some((command) => command.includes('lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv')));

  assert.match(grubConfig, /search --no-floppy --file --set=alga_root \/etc\/alga-appliance\/booted-from-disk/);
  assert.match(grubConfig, /configfile \/boot\/grub\/grub.cfg/);
});
