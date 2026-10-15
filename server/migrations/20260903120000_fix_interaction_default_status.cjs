/**
 * Interactions were seeded with "Completed" (a closed status) as the default, so every
 * interaction created without an explicit status — a logged call, an email — was born
 * closed. The default for a newly logged interaction must be an open status.
 *
 * Repairs the global standard_statuses catalog (Planned becomes the interaction default)
 * and, per tenant, moves is_default off the closed seed. Tenants that already picked an
 * open default, or have no interaction statuses at all, are left alone.
 */

const MIGRATION_TENANT = 'migration:20260903120000_fix_interaction_default_status';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for interaction default status repair';

exports.up = async function up(knex) {
  const { tenantDb } = require('./utils/tenantDb.cjs');
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);

  // Global reference catalog (standard_statuses is scope: 'global').
  await migrationDb.table('standard_statuses')
    .where({ item_type: 'interaction', name: 'Completed' })
    .update({ is_default: false });

  await migrationDb.table('standard_statuses')
    .where({ item_type: 'interaction', name: 'Planned' })
    .update({ is_default: true });

  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);

    const interactionStatuses = await db.table('statuses')
      .where({ status_type: 'interaction' })
      .select('status_id', 'name', 'is_closed', 'is_default', 'order_number');

    if (interactionStatuses.length === 0) {
      continue;
    }

    const defaults = interactionStatuses.filter((status) => status.is_default);
    // Only repair the untouched seed: a tenant whose default is already open (or who has
    // deliberately cleared the default) keeps whatever it configured.
    if (defaults.length === 0 || defaults.some((status) => !status.is_closed)) {
      continue;
    }

    const openStatuses = interactionStatuses
      .filter((status) => !status.is_closed)
      .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));

    const replacement = openStatuses.find((status) => status.name === 'Planned') || openStatuses[0];
    if (!replacement) {
      continue;
    }

    await db.table('statuses')
      .where({ status_type: 'interaction', is_default: true })
      .update({ is_default: false });

    await db.table('statuses')
      .where({ status_id: replacement.status_id })
      .update({ is_default: true });
  }
};

// Restores the shipped catalog only. Per-tenant defaults are not rolled back: after this
// migration an open interaction default is indistinguishable from one an admin chose.
exports.down = async function down(knex) {
  const { tenantDb } = require('./utils/tenantDb.cjs');
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);

  await migrationDb.table('standard_statuses')
    .where({ item_type: 'interaction', name: 'Planned' })
    .update({ is_default: false });

  await migrationDb.table('standard_statuses')
    .where({ item_type: 'interaction', name: 'Completed' })
    .update({ is_default: true });
};
