import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const stageScript = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'stage-control-plane-bundle.sh');

test('control-plane bundle staging writes installed-appliance paths for manifests, storage, images, and metadata', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-control-plane-stage-'));
  const overlayRoot = path.join(tmp, 'overlay');
  const imageArchive = path.join(tmp, 'alga-appliance-control-plane.tar');
  const k3sBinary = path.join(tmp, 'k3s');
  fs.writeFileSync(imageArchive, 'fake image archive');
  fs.writeFileSync(k3sBinary, '#!/bin/sh\necho fake k3s\n', { mode: 0o755 });

  const result = spawnSync(stageScript, [
    '--repo-root', repoRoot,
    '--overlay-root', overlayRoot,
    '--image-archive', imageArchive,
    '--k3s-binary', k3sBinary
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const applianceRoot = path.join(overlayRoot, 'opt', 'alga-appliance');
  assert.equal(fs.existsSync(path.join(applianceRoot, 'control-plane', 'manifests', 'kustomization.yaml')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'control-plane', 'manifests', 'namespace.yaml')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'control-plane', 'manifests', 'rbac.yaml')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'control-plane', 'manifests', 'workload.yaml')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'manifests', 'local-path-storage.yaml')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'bin', 'alga-control-plane-reapply')), true);
  assert.equal((fs.statSync(path.join(applianceRoot, 'bin', 'alga-control-plane-reapply')).mode & 0o111) !== 0, true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'bin', 'k3s')), true);
  assert.equal((fs.statSync(path.join(applianceRoot, 'bin', 'k3s')).mode & 0o111) !== 0, true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'scripts', 'bootstrap-control-plane.sh')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'scripts', 'install-storage.sh')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'host-service', 'init-token.mjs')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'host-service', 'support-bundle.mjs')), true);
  assert.equal(fs.existsSync(path.join(applianceRoot, 'host-service', 'host-agent.mjs')), true);
  assert.equal((fs.statSync(path.join(applianceRoot, 'scripts', 'bootstrap-control-plane.sh')).mode & 0o111) !== 0, true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'alga-appliance-bootstrap.service')), true);
  const bootstrapService = fs.readFileSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'alga-appliance-bootstrap.service'), 'utf8');
  assert.doesNotMatch(bootstrapService, /ExecStartPre=\/usr\/bin\/env node \/opt\/alga-appliance\/host-service\/console\.mjs/);
  assert.match(bootstrapService, /ExecStartPre=\/usr\/bin\/env node \/opt\/alga-appliance\/host-service\/init-token\.mjs/);
  assert.doesNotMatch(bootstrapService, /init-admin-credential/);
  assert.match(bootstrapService, /ExecStart=\/opt\/alga-appliance\/scripts\/bootstrap-control-plane\.sh/);
  assert.match(bootstrapService, /ALGA_APPLIANCE_CONSOLE_TTYS=\/dev\/tty1,\/dev\/console/);
  assert.match(bootstrapService, /ExecStartPost=\/usr\/bin\/env node \/opt\/alga-appliance\/host-service\/console\.mjs/);
  assert.ok(
    bootstrapService.indexOf('init-token.mjs') < bootstrapService.indexOf('ExecStartPost=/usr/bin/env node /opt/alga-appliance/host-service/console.mjs'),
    'staged bootstrap service must initialize the token before the post-bootstrap banner'
  );
  assert.match(bootstrapService, /StandardOutput=journal\+console/);
  assert.doesNotMatch(bootstrapService, /host-service\/server\.mjs/);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'alga-host-agent.service')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'etc', 'sysusers.d', 'alga-appliance.conf')), true);
  assert.match(fs.readFileSync(path.join(overlayRoot, 'etc', 'sysusers.d', 'alga-appliance.conf'), 'utf8'), /g alga-appliance 10001/);
  const hostAgentService = fs.readFileSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'alga-host-agent.service'), 'utf8');
  assert.match(hostAgentService, /host-agent\.sock/);
  assert.match(hostAgentService, /systemd-sysusers \/etc\/sysusers\.d\/alga-appliance\.conf/);
  assert.match(hostAgentService, /host-service\/host-agent\.mjs/);
  assert.equal(fs.readlinkSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'multi-user.target.wants', 'alga-appliance-bootstrap.service')), '../alga-appliance-bootstrap.service');
  assert.equal(fs.readlinkSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'multi-user.target.wants', 'alga-host-agent.service')), '../alga-host-agent.service');
  assert.equal(fs.readlinkSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'alga-appliance.service')), '/dev/null');
  assert.equal(fs.existsSync(path.join(overlayRoot, 'etc', 'systemd', 'system', 'multi-user.target.wants', 'alga-appliance.service')), false);
  assert.equal(fs.readFileSync(path.join(applianceRoot, 'control-plane', 'images', 'alga-appliance-control-plane.tar'), 'utf8'), 'fake image archive');

  const bundle = JSON.parse(fs.readFileSync(path.join(applianceRoot, 'control-plane', 'bundle.json'), 'utf8'));
  assert.equal(bundle.origin, 'baked-iso');
  assert.equal(bundle.manifestPath, '/opt/alga-appliance/control-plane/manifests');
  assert.equal(bundle.imagePath, '/opt/alga-appliance/control-plane/images');
  assert.equal(bundle.localPathStorageManifest, '/opt/alga-appliance/manifests/local-path-storage.yaml');
  assert.equal(bundle.fallbackCommand, '/opt/alga-appliance/bin/alga-control-plane-reapply');
  assert.equal(bundle.bootstrapScript, '/opt/alga-appliance/scripts/bootstrap-control-plane.sh');
  assert.equal(bundle.k3sBinaryPath, '/opt/alga-appliance/bin/k3s');
  assert.equal(bundle.imageArchiveCount, 1);
});

test('control-plane bundle staging fails closed when no image archive is available', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-control-plane-stage-no-image-'));
  const result = spawnSync(stageScript, [
    '--repo-root', repoRoot,
    '--overlay-root', path.join(tmp, 'overlay')
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No control-plane image archive was staged/);
});
