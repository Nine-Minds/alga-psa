import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const buildScript = path.join(repoRoot, 'ee', 'appliance', 'ubuntu-iso', 'scripts', 'build-ubuntu-appliance-iso.sh');
const overlayRoot = path.join(repoRoot, 'ee', 'appliance', 'ubuntu-iso', 'overlay', 'opt', 'alga-appliance');
const outputRoot = path.join(repoRoot, 'ee', 'appliance', 'ubuntu-iso', 'output');

function run(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', env: process.env });
}

test('T001 build smoke: dry-run and scaffold build stage host artifacts and output files', () => {
  const tmpIso = path.join(os.tmpdir(), `alga-ubuntu-base-${Date.now()}.iso`);
  const releaseVersion = `test-${Date.now()}`;
  fs.writeFileSync(tmpIso, 'fake-iso-content');

  const dryRun = run('bash', [buildScript, '--base-iso', tmpIso, '--release-version', releaseVersion, '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /layout validated/i);

  const build = run('bash', [buildScript, '--base-iso', tmpIso, '--release-version', releaseVersion, '--scaffold']);
  assert.equal(build.status, 0, build.stderr || build.stdout);

  assert.equal(fs.existsSync(path.join(overlayRoot, 'appliance')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'host-service')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'operator')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'scripts')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'flux')), true);
  assert.equal(fs.existsSync(path.join(overlayRoot, 'releases')), true);

  const isoOut = path.join(outputRoot, `alga-appliance-ubuntu-${releaseVersion}.iso`);
  const shaOut = `${isoOut}.sha256`;
  assert.equal(fs.existsSync(isoOut), true);
  assert.equal(fs.existsSync(shaOut), true);
});
