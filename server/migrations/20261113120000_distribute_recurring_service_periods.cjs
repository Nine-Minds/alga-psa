'use strict';
const { distributeLocalTenantTables } = require('./utils/citusDistribution.cjs');

// recurring_service_periods was never distributed, so every due-work listing,
// invoice count and contract-line save that joins it to contract_lines or
// invoices is a recursively planned subplan shipped over a loopback
// connection — those fail whenever the coordinator is near max_connections.
// Its keys already carry tenant; co-locate it with contract_lines.

const TABLE = 'recurring_service_periods';

exports.up = async function up(knex) {
  await distributeLocalTenantTables(knex, {
    tables: [TABLE],
    colocateWith: 'contract_lines',
    // 20260904130000 installs this trigger only where the table is local; once
    // distributed the per-tenant billing lock is the application's
    // (lockTenantBilling) — every recurring_service_periods writer must take
    // it explicitly.
    dropTriggers: { [TABLE]: ['billing_semantics_mutation'] },
  });
};

// Forward-only: undistribute_table() would have to cascade through contract_lines.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
