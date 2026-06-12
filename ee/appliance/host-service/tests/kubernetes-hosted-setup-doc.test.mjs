import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const docPath = path.join(repoRoot, 'ee', 'docs', 'appliance', 'kubernetes-hosted-setup.md');

test('T009 runbook documents bootstrap layers, fallback, logs, and new-install boundary', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  assert.match(doc, /fresh installs/);
  assert.match(doc, /does not migrate existing host-based setup installs/);
  assert.match(doc, /Host substrate bootstrap starts k3s/);
  assert.match(doc, /baked control-plane image archive/);
  assert.match(doc, /alga-appliance-control-plane/);
  assert.match(doc, /existing setup port, `8080`/);
  assert.match(doc, /alga-appliance-bootstrap\.service/);
  assert.match(doc, /\/opt\/alga-appliance\/scripts\/bootstrap-control-plane\.sh/);
  assert.match(doc, /\/opt\/alga-appliance\/bin\/alga-control-plane-reapply/);
  assert.match(doc, /must not delete/);
  assert.match(doc, /journalctl -u alga-appliance-bootstrap\.service -u k3s -f/);
  assert.match(doc, /support bundle includes host bootstrap logs/);
  assert.match(doc, /Fresh-Install Smoke Test/);
});
