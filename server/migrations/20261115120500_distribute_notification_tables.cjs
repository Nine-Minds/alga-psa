'use strict';
const { distributeLocalTenantTables } = require('./utils/citusDistribution.cjs');

// 20251211120000 distributes notification_logs, user_notification_preferences
// and tenant_email_templates on a fresh Citus chain and calls that a no-op "on
// prod, where everything is already converted". Production never was: there
// these three are still plain coordinator-local tables (checked 2026-11-15),
// and notification_settings was never distributed anywhere. A local table
// joined to a distributed one is recursively planned into a subplan shipped
// over a loopback connection, which fails whenever the coordinator is near
// max_connections, and Citus refuses some of those joins outright.
//
// Every key already leads with tenant (primary keys are (tenant, id)), none of
// the four has triggers, and nothing references them, so they move as they
// are, next to tenants and users. On production no row points at a missing
// user or tenant, so the helper's orphan repair removes nothing there.
//
// No-op on plain Postgres and for tables already distributed, which is all but
// notification_settings on a fresh Citus chain.

const COLOCATE_WITH = 'tenants';

const TABLES = [
  'notification_settings',
  'tenant_email_templates',
  'user_notification_preferences',
  'notification_logs',
];

exports.up = async function up(knex) {
  await distributeLocalTenantTables(knex, {
    tables: TABLES,
    colocateWith: COLOCATE_WITH,
  });
};

// Forward-only: undistribute_table() would have to cascade through tenants and users.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
