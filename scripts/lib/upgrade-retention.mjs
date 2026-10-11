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
    contract_line_buckets: ['bucket_id', 'contract_line_id', 'bucket_name', 'total_minutes', 'overage_rate', 'allow_rollover', 'billing_period', 'after_hours_multiplier', 'business_hours_schedule_id', 'covers_all_services'],
    contract_line_bucket_services: ['bucket_id', 'service_id', 'contract_line_id', 'burn_multiplier'],
    bucket_usage: ['usage_id', 'client_id', 'contract_line_id', 'bucket_id', 'service_catalog_id', 'period_start', 'period_end', 'minutes_used', 'overage_minutes', 'rolled_over_minutes'],
  };
  for (const { tenant } of fixture.identities) {
    result[tenant] = {};
    for (const [table, fields] of Object.entries(columns)) {
      const order = table === 'contract_line_bucket_services' ? ['bucket_id', 'service_id'] : fields[0];
      result[tenant][table] = await db(table).where({ tenant }).select(fields).orderBy(order);
      // An unused pool legitimately has no usage yet; preserve its empty state
      // too, so an upgrade cannot manufacture consumption or rollover.
      if (table !== 'bucket_usage') assert.ok(result[tenant][table].length > 0, `Baseline fixture has no ${table}`);
    }
  }
  return JSON.parse(JSON.stringify(result));
}

// The obligation_type collapse (alga0002072) is the one sanctioned rewrite of
// retained records: legacy `schedule:{tenant}:{label}:{id}:{owner}:{due}` keys
// lose their label. Every other value must survive the upgrade unchanged.
// LEVERAGE: pattern schedule-key-legacy-label — mirrors shared/billingClients/recurringServicePeriodKeys.ts and the collapse migration; .mjs tooling cannot import the TS parser.
const LEGACY_OBLIGATION_TYPES = new Set(['contract_line', 'client_contract_line', 'template_line', 'preset_line']);
const collapseLegacyScheduleKey = key => {
  const segments = typeof key === 'string' ? key.split(':') : [];
  return segments.length === 6 && segments[0] === 'schedule' && LEGACY_OBLIGATION_TYPES.has(segments[2])
    ? [...segments.slice(0, 2), ...segments.slice(3)].join(':') : key;
};
const expectedAfterUpgrade = before => Object.fromEntries(Object.entries(before).map(([tenant, tables]) => [tenant,
  { ...tables, ...(tables.recurring_service_periods && { recurring_service_periods: tables.recurring_service_periods
    .map(row => Object.hasOwn(row, 'schedule_key') ? { ...row, schedule_key: collapseLegacyScheduleKey(row.schedule_key) } : row) }) }]));

export function verifyUpgradeRetention(before, after, baselineLedger, upgradedLedger) {
  assert.deepEqual(after, expectedAfterUpgrade(before), 'Upgrade changed pre-existing business records');
  assert.ok(baselineLedger.length > 0, 'Baseline migration ledger is empty');
  for (const row of baselineLedger) {
    assert.deepEqual(upgradedLedger.find(item => item.name === row.name), row, `Baseline migration history changed: ${row.name}`);
  }
  assert.ok(upgradedLedger.length >= baselineLedger.length, 'Upgrade lost migration history');
}
