import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));

test('F019 new-install primary host path is Kubernetes bootstrap, not legacy host API service', () => {
  const service = fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'systemd', 'alga-appliance-bootstrap.service'), 'utf8');
  const readme = fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'systemd', 'README.md'), 'utf8');

  assert.match(service, /Description=Alga Appliance Kubernetes Control Plane Bootstrap/);
  assert.match(service, /ExecStartPre=\/usr\/bin\/env node \/opt\/alga-appliance\/host-service\/init-token\.mjs/);
  assert.match(service, /ExecStartPre=\/usr\/bin\/env node \/opt\/alga-appliance\/host-service\/init-admin-credential\.mjs/);
  assert.match(service, /ExecStart=\/opt\/alga-appliance\/scripts\/bootstrap-control-plane\.sh/);
  assert.match(service, /RemainAfterExit=yes/);

  const tokenIndex = service.indexOf('ExecStartPre=/usr/bin/env node /opt/alga-appliance/host-service/init-token.mjs');
  const adminIndex = service.indexOf('ExecStartPre=/usr/bin/env node /opt/alga-appliance/host-service/init-admin-credential.mjs');
  const bootstrapIndex = service.indexOf('ExecStart=/opt/alga-appliance/scripts/bootstrap-control-plane.sh');
  const consoleIndex = service.indexOf('ExecStartPost=/usr/bin/env node /opt/alga-appliance/host-service/console.mjs');
  assert.ok(tokenIndex !== -1 && adminIndex > tokenIndex && bootstrapIndex > adminIndex && consoleIndex > bootstrapIndex,
    'bootstrap service must initialize the token/admin credential before rendering the console banner');
  assert.doesNotMatch(service, /host-service\/server\.mjs/);
  assert.doesNotMatch(service, /ALGA_APPLIANCE_STATE_FILE/);
  assert.match(readme, /legacy host API service is not part of the new-install primary path/);
});
