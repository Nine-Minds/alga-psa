import assert from 'node:assert/strict';
import test from 'node:test';

test('emitted co-managed purchase module loads and exports its purchase states', async () => {
  const emitted = await import('../dist/packages/co-managed/src/upgradePurchase.js');

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
