import test from 'node:test';
import assert from 'node:assert/strict';
import { UPGRADE_DISTRIBUTED_TABLES, verifyUpgradeDistribution } from '../lib/upgrade-citus.mjs';
const distributed = () => UPGRADE_DISTRIBUTED_TABLES.map(table_name => ({ table_name, partmethod: 'h', distribution_column: 'tenant' }));
test('upgrade accepts tenant-distributed core tables', () => {
  assert.deepEqual(verifyUpgradeDistribution(distributed()), distributed());
});
for (const corruption of ['missing', 'reference', 'wrong-key', 'duplicate']) {
  test(`upgrade rejects ${corruption} distribution metadata`, () => {
    const rows = distributed();
    if (corruption === 'missing') rows.pop();
    if (corruption === 'reference') rows[0].partmethod = 'n';
    if (corruption === 'wrong-key') rows[0].distribution_column = 'user_id';
    if (corruption === 'duplicate') rows.push({ ...rows[0] });
    assert.throws(() => verifyUpgradeDistribution(rows));
  });
}
