import assert from 'node:assert/strict';

// Compare business values, including IDs, rather than only aggregate counts.
export async function captureUpgradeRecords(db, fixture) {
  const result = {};
  const columns = {
    recurring_service_periods: ['record_id', 'obligation_id', 'schedule_key', 'period_key', 'service_period_start', 'service_period_end', 'lifecycle_state'],
    tickets: ['ticket_id', 'ticket_number', 'client_id', 'title', 'status_id', 'board_id', 'priority_id'],
    contracts: ['contract_id', 'contract_name', 'status', 'currency_code'],
    usage_tracking: ['usage_id', 'client_id', 'service_id', 'contract_line_id', 'usage_date', 'quantity', 'invoiced'],
    time_entries: ['entry_id', 'user_id', 'work_item_id', 'contract_line_id', 'billable_duration', 'approval_status', 'invoiced'],
  };
  for (const { tenant } of fixture.identities) {
    result[tenant] = {};
    for (const [table, fields] of Object.entries(columns)) {
      result[tenant][table] = await db(table).where({ tenant }).select(fields).orderBy(fields[0]);
      assert.ok(result[tenant][table].length > 0, `Baseline fixture has no ${table}`);
    }
  }
  return JSON.parse(JSON.stringify(result));
}

export function verifyUpgradeRetention(before, after, baselineLedger, upgradedLedger) {
  assert.deepEqual(after, before, 'Upgrade changed pre-existing business records');
  assert.ok(baselineLedger.length > 0, 'Baseline migration ledger is empty');
  for (const row of baselineLedger) {
    assert.deepEqual(upgradedLedger.find(item => item.name === row.name), row, `Baseline migration history changed: ${row.name}`);
  }
  assert.ok(upgradedLedger.length >= baselineLedger.length, 'Upgrade lost migration history');
}
