import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coManagedRequirementKeys } from '../lib/co-managed-plan-ids.mjs';
import { evaluateCoManagedCompletion } from '../lib/co-managed-completion.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('a current source census preserves every required ID without accepting unproved behavior', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'co-managed-current-inventory-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync(process.execPath, ['scripts/build-co-managed-inventory.mjs', '--out', directory], { cwd: root });
  const inventory = JSON.parse(readFileSync(path.join(directory, 'inventory.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const expected = coManagedRequirementKeys(root);
  assert.deepEqual(inventory.failures, []);
  assert.equal(inventory.rows.length, 260);
  assert.deepEqual(inventory.rows.map(row => row.key).sort(), [...expected.keys].sort());
  for (const row of inventory.rows) {
    assert.ok(existsSync(path.join(root, row.planPath)), row.planPath);
    assert.ok(row.remainingAcceptance.includes(row.description), row.key);
    assert.ok(row.sourceReferences.length > 1, row.key);
    for (const reference of row.sourceReferences) {
      assert.match(reference.sha256, /^[a-f0-9]{64}$/, `${row.key}: ${reference.path}`);
    }
    assert.notEqual(row.status, 'verified', `${row.key}: source presence cannot establish acceptance`);
  }
  assert.equal(manifest.evidence['current-source-census'].type, 'analysis');
  assert.deepEqual(manifest.requirements.filter(row => row.status === 'failed'), []);
  assert.deepEqual(manifest.openDefects, []);
  assert.equal(manifest.provenance.app.revision, null);
  assert.equal(manifest.provenance.worker.revision, null);
  assert.deepEqual(manifest.ci.checks, []);
  const verdict = evaluateCoManagedCompletion({ manifest, expectedRequirementIds: expected.keys });
  assert.equal(verdict.implementationReady, false);
  assert.equal(verdict.humanReviewReady, false);
  assert.equal(verdict.productionReady, false);
  assert.equal(verdict.blocking.implementation.some(reason => /absent from the manifest|unknown requirement/.test(reason)), false);
  const markdown = readFileSync(path.join(directory, 'inventory.md'), 'utf8');
  assert.ok(markdown.includes('## Native ticket screen features F001–F037'));
  assert.ok(markdown.includes('## Native ticket screen tests T001–T014'));
  const remaining = readFileSync(path.join(directory, 'remaining-acceptance.md'), 'utf8');
  const reportedIds = [...remaining.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(reportedIds.sort(), [...expected.keys].sort());
});
