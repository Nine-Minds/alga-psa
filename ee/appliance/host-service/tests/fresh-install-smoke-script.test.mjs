import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const stageScript = path.join(repoRoot, 'ee', 'appliance', 'ubuntu-iso', 'scripts', 'stage-host-artifacts.sh');
const smokeScript = path.join(repoRoot, 'ee', 'appliance', 'tests', 'kubernetes-hosted-fresh-install-smoke.sh');

test('T008 fresh-install smoke harness validates offline overlay assets and live VM checks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-fresh-install-smoke-'));
  const overlayRoot = path.join(tmp, 'overlay');
  const imageArchive = path.join(tmp, 'alga-appliance-control-plane.tar');
  const k3sBinary = path.join(tmp, 'k3s');
  fs.writeFileSync(imageArchive, 'fake image archive');
  fs.writeFileSync(k3sBinary, '#!/bin/sh\necho fake k3s\n', { mode: 0o755 });

  const stage = spawnSync(stageScript, [
    '--repo-root', repoRoot,
    '--overlay-root', overlayRoot,
    '--control-plane-image-archive', imageArchive,
    '--k3s-binary', k3sBinary
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ALGA_APPLIANCE_STATUS_UI_SKIP_BUILD: '1',
      ALGA_APPLIANCE_STATUS_UI_ALLOW_MISSING_DIST: '1',
      ALGA_APPLIANCE_BUILD_TIMESTAMP: '2026-05-27T19:42:11Z'
    }
  });
  assert.equal(stage.status, 0, stage.stderr || stage.stdout);

  const preflight = spawnSync(smokeScript, [
    'preflight',
    '--overlay-root', overlayRoot
  ], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  assert.match(preflight.stdout, /PASS: ISO overlay contains Kubernetes-hosted control-plane bootstrap assets/);
  const buildInfo = JSON.parse(fs.readFileSync(path.join(overlayRoot, 'etc', 'alga-appliance', 'build-info.json'), 'utf8'));
  assert.equal(buildInfo.buildTimestamp, '2026-05-27T19:42:11Z');

  const script = fs.readFileSync(smokeScript, 'utf8');
  // Session-based auth: redeem the one-time token, set a password, reuse the cookie.
  assert.match(script, /api\/auth\/redeem-token/);
  assert.match(script, /api\/auth\/set-password/);
  assert.match(script, /local setup_api_url="\$\{base\}\/api\/setup"/);
  assert.match(script, /curl -fsS -b "\$cookie_jar" -X POST "\$setup_api_url"/);
  assert.doesNotMatch(script, /\?token=/);
  assert.match(script, /alga-appliance-control-plane get deploy appliance-control-plane/);
  assert.match(script, /appliance-initial-tenant/);
  assert.match(script, /alga-control-plane-reapply/);
  assert.match(script, /ready_to_log_in/);
});
