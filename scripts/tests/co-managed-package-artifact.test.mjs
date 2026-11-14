import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('emitted co-managed purchase module loads and exports its purchase states', { timeout: 180_000 }, async () => {
  execFileSync('npm', ['run', 'build', '--workspace=temporal-workflows'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'pipe', timeout: 180_000,
  });
  const emitted = await import('../../ee/temporal-workflows/dist/packages/co-managed/src/upgradePurchase.js');

  assert.deepEqual(emitted.CO_MANAGED_UPGRADE_PURCHASE_STATES, [
    'preparing',
    'checkout',
    'paid',
    'expired',
    'payment_failed',
  ]);
  assert.deepEqual(emitted.CO_MANAGED_UPGRADE_PENDING_STATES, [
    'preparing',
    'checkout',
    'payment_failed',
  ]);
  assert.ok(emitted.CO_MANAGED_UPGRADE_PENDING_STATES.every((state) =>
    emitted.CO_MANAGED_UPGRADE_PURCHASE_STATES.includes(state)));
});
