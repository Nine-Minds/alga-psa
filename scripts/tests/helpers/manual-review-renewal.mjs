import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectVitestInventory } from '../../lib/vitest-inventory-collection.mjs';
import { reconcileDiscovery } from '../../lib/test-discovery.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

// Pins a manual Vitest runner review renewal: after `now` (past the previous
// deadline) the old expiry must be rejected and the renewed entry in
// scripts/manual-vitest-runners.json must collect its real cases. Each renewal
// lives in its own test file because real collection spawns Vitest against the
// repository, and the Node tooling lane gives every file a fixed time budget.
export function assertRenewedReviewCollects(t, { runner: name, previousExpiry, now, inspect }) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
  const output = mkdtempSync(path.join(tmpdir(), `renewed-${name}-`));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const runners = JSON.parse(readFileSync(path.join(root, 'scripts/manual-vitest-runners.json'), 'utf8'));
  const runner = runners.find(entry => entry.runner === name);
  assert.ok(runner, `Missing manual runner: ${name}`);
  assert.throws(() => collectVitestInventory({ root, output,
    runner: { ...runner, expires: previousExpiry } }), /unexpired review/);

  const collection = collectVitestInventory({ root, runner, output,
    env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '0', REQUIRE_DB: '' } });
  assert.equal(collection.status, 'passed', collection.failures.join('\n'));
  assert.equal(collection.mandatory, false);
  assert.deepEqual([...collection.files].sort(), runner.filters.map(file => `${runner.cwd}/${file}`).sort());
  assert.ok(collection.collectedTests >= collection.files.length);
  inspect?.(collection);
  const discovery = reconcileDiscovery({ root, candidates: collection.files, collections: [collection] });
  assert.equal(discovery.status, 'passed', discovery.failures.join('\n'));
}
