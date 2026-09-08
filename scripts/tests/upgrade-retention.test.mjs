import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyUpgradeRetention } from '../lib/upgrade-retention.mjs';
const data = { tenant: { tickets: [{ ticket_id: 'a', title: 'Retained title' }], usage: [{ quantity: 2, invoiced: false }] } };
const ledger = [{ id: 1, name: 'old.cjs', batch: 1 }];
test('retention accepts preserved values and appended migration history', () => {
  verifyUpgradeRetention(data, structuredClone(data), ledger, [...ledger, { id: 2, name: 'new.cjs', batch: 2 }]);
});
for (const change of ['title', 'quantity', 'delete', 'ledger']) {
  test(`retention rejects ${change} corruption`, () => {
    const after = structuredClone(data), history = structuredClone(ledger);
    if (change === 'title') after.tenant.tickets[0].title = 'Lost title';
    if (change === 'quantity') after.tenant.usage[0].quantity = 3;
    if (change === 'delete') after.tenant.tickets = [];
    if (change === 'ledger') history[0].batch = 2;
    assert.throws(() => verifyUpgradeRetention(data, after, ledger, history));
  });
}
