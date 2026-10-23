#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY audit for alga0002072 (collapse recurring_service_periods.obligation_type).
 * Prints the JSON report produced by the migration's precheck. Safe to run
 * against prod or a prod snapshot; it issues SELECTs only.
 *
 * Usage:
 *   DB_HOST=... DB_PORT=... DB_NAME=server DB_USER=postgres DB_PASSWORD=... \
 *     node server/scripts/audit-recurring-service-period-obligation-labels.cjs
 * (or pass DATABASE_URL). Exit code 2 when the escalation gate trips
 * (double-billed collisions, overlapping live periods, multi-family obligations).
 */

const path = require('node:path');
const knexFactory = require('knex');
const migration = require(path.join(__dirname, '..', 'migrations', '20261010120000_collapse_recurring_service_period_obligation_type.cjs'));

async function main() {
  const connection = process.env.DATABASE_URL || {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || process.env.DB_NAME_SERVER || 'server',
    user: process.env.DB_USER || process.env.DB_USER_ADMIN || 'postgres',
    password: process.env.DB_PASSWORD || process.env.DB_PASSWORD_ADMIN,
  };
  const knex = knexFactory({ client: 'pg', connection, pool: { min: 0, max: 2 } });
  try {
    await knex.raw('SET default_transaction_read_only = on');
    const report = await migration.auditObligationLabelCollapse(knex);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.escalate ? 2 : 0;
  } finally {
    await knex.destroy();
  }
}

main().catch((error) => {
  console.error('audit failed:', error.message);
  process.exit(1);
});
