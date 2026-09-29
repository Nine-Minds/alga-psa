import test from 'node:test';
import assert from 'node:assert/strict';
import { captureUpgradeRecords, verifyUpgradeRetention } from '../lib/upgrade-retention.mjs';
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

// In-memory storage boundary executes tenant filters, column projections and
// sorting. The migration runner separately exercises this capture against PG.
function recordsFixture() {
  const rows = { recurring_service_periods: [], tickets: [], contracts: [], usage_tracking: [], time_entries: [],
    contract_line_buckets: [], contract_line_bucket_services: [], bucket_usage: [] };
  for (const tenant of ['primary', 'secondary']) {
    for (const [table, id] of [['recurring_service_periods', 'record_id'], ['tickets', 'ticket_id'],
      ['contracts', 'contract_id'], ['usage_tracking', 'usage_id'], ['time_entries', 'entry_id']]) rows[table].push({ tenant, [id]: tenant });
    rows.contract_line_buckets.push({ tenant, bucket_id: 'shared-id', contract_line_id: tenant,
      bucket_name: tenant, total_minutes: tenant === 'primary' ? 2400 : 600, overage_rate: '15000.00',
      allow_rollover: true, billing_period: 'monthly', after_hours_multiplier: null,
      business_hours_schedule_id: null, covers_all_services: false });
    for (const [service_id, burn_multiplier] of [['b', '2.000'], ['a', '1.000']]) {
      rows.contract_line_bucket_services.push({ tenant, bucket_id: 'shared-id', contract_line_id: tenant, service_id, burn_multiplier });
    }
  }
  const db = table => ({ where(filter) { return { select(fields) { return { orderBy(order) {
    const keys = Array.isArray(order) ? order : [order];
    return rows[table].filter(row => Object.entries(filter).every(([key, value]) => row[key] === value))
      .map(row => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])))
      .sort((a, b) => { for (const key of keys) { const comparison = String(a[key]).localeCompare(String(b[key])); if (comparison) return comparison; } return 0; });
  } }; } }; } });
  return { rows, capture: () => captureUpgradeRecords(db, { identities: [{ tenant: 'primary' }, { tenant: 'secondary' }] }) };
}

test('capture preserves tenant-specific pools, deterministic member weights and empty usage', async () => {
  const fixture = recordsFixture();
  const before = await fixture.capture();
  assert.equal(before.primary.contract_line_buckets[0].total_minutes, 2400);
  assert.equal(before.secondary.contract_line_buckets[0].total_minutes, 600);
  assert.deepEqual(before.primary.contract_line_bucket_services.map(row => [row.service_id, row.burn_multiplier]), [['a', '1.000'], ['b', '2.000']]);
  assert.deepEqual(before.primary.bucket_usage, []);
  fixture.rows.contract_line_bucket_services.reverse();
  verifyUpgradeRetention(before, await fixture.capture(), ledger, ledger);
});

for (const [label, mutate] of [
  ['capacity', rows => { rows.contract_line_buckets[0].total_minutes = 1; }],
  ['member weight', rows => { rows.contract_line_bucket_services[0].burn_multiplier = '3.000'; }],
  ['member removal', rows => { rows.contract_line_bucket_services.shift(); }],
  ['invented usage', rows => { rows.bucket_usage.push({ tenant: 'primary', usage_id: 'new', bucket_id: 'shared-id', minutes_used: 60, rolled_over_minutes: 0 }); }],
]) test(`captured bucket ${label} corruption rejects upgrade`, async () => {
  const fixture = recordsFixture(), before = await fixture.capture();
  mutate(fixture.rows);
  await assert.rejects(async () => verifyUpgradeRetention(before, await fixture.capture(), ledger, ledger));
});

for (const field of ['minutes_used', 'overage_minutes', 'rolled_over_minutes']) test(`capture retains existing ${field} through upgrade`, async () => {
  const fixture = recordsFixture();
  fixture.rows.bucket_usage.push({ tenant: 'primary', usage_id: 'existing', client_id: 'client',
    contract_line_id: 'primary', bucket_id: 'shared-id', service_catalog_id: 'a',
    period_start: '2026-09-01', period_end: '2026-10-01', minutes_used: 240,
    overage_minutes: 30, rolled_over_minutes: 60 });
  const before = await fixture.capture();
  assert.deepEqual(before.primary.bucket_usage, [{ usage_id: 'existing', client_id: 'client',
    contract_line_id: 'primary', bucket_id: 'shared-id', service_catalog_id: 'a',
    period_start: '2026-09-01', period_end: '2026-10-01', minutes_used: 240,
    overage_minutes: 30, rolled_over_minutes: 60 }]);
  fixture.rows.bucket_usage[0][field]++;
  const after = await fixture.capture();
  assert.throws(() => verifyUpgradeRetention(before, after, ledger, ledger));
});
