import test from 'node:test';
import assert from 'node:assert/strict';
import { UPGRADE_DISTRIBUTED_TABLES, verifyUpgradeDistribution } from '../lib/upgrade-citus.mjs';
const distributed = () => [
  ...UPGRADE_DISTRIBUTED_TABLES.map(table_name => ({ table_name, partmethod: 'h', distribution_column: 'tenant' })),
  ...['usage_tracking', 'time_entries'].map(table_name => ({ table_name, partmethod: null, distribution_column: null })),
];
test('upgrade accepts tenant-distributed core tables', () => {
  assert.deepEqual(verifyUpgradeDistribution(distributed()), distributed());
});
test('upgrade retains observed billing distribution when a candidate distributes it', () => {
  const rows = distributed();
  rows.at(-1).partmethod = 'h';
  rows.at(-1).distribution_column = 'tenant';
  assert.deepEqual(verifyUpgradeDistribution(rows), rows);
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
