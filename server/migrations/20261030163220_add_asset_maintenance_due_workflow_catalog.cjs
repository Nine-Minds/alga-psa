'use strict';

const { tenantDb } = require('./utils/tenantDb.cjs');
const MIGRATION_TENANT = 'migration:20261030163220_add_asset_maintenance_due_workflow_catalog';

// Documentation row: the designer redirects this selection to the date source.
const ROW = {
  event_type: 'ASSET_MAINTENANCE_DUE',
  name: 'Asset Maintenance Due',
  description: 'Date trigger for open asset maintenance occurrences on active, non-archived plans. Select this entry to configure the maintenance-due date source, offset and local scan time; it is not a published domain event.',
  category: 'Assets',
  payload_schema_ref: 'payload.AssetMaintenanceDue.v1',
};
const NOW = '2026-10-30T00:00:00.000Z';

exports.up = async function up(knex) {
  const db = tenantDb(knex, MIGRATION_TENANT);
  await db.unscoped('system_event_catalog', 'Register a system-wide maintenance date-trigger documentation entry')
    .insert({ ...ROW, created_at: NOW, updated_at: NOW })
    .onConflict('event_type').merge({ ...ROW, updated_at: NOW });
};

exports.down = async function down(knex) {
  const db = tenantDb(knex, MIGRATION_TENANT);
  await db.unscoped('system_event_catalog', 'Remove only the maintenance date-trigger documentation entry')
    .where({ event_type: ROW.event_type }).del();
};
